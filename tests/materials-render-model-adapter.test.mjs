/**
 * The temporary writer-JSON → render-model adapter
 * (server/materials-render-model-adapter.mjs). It must produce a valid
 * materials.render-model.v1 from today's writer output and invent nothing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRenderModelFromWriter, buildRenderModelFromDraft, classifyContact, matchMark, tagMetrics } from "../server/materials-render-model-adapter.mjs";
import { renderDocument, runsToText, validateRenderModel } from "../server/materials-render.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { EXAMPLE_MARKS, EXAMPLE_RESUME_TEXT, EXAMPLE_WRITER_JSON } from "./fixtures/materials-example-writer.mjs";

/** @param {string} [family] */
function build(family = "signal", writerJson = EXAMPLE_WRITER_JSON) {
  return buildRenderModelFromWriter({
    writerJson,
    resumeText: EXAMPLE_RESUME_TEXT,
    request: { company: "Acme Robotics", title: "Operations Analytics Manager" },
    family: resolveFamily(family),
    marks: EXAMPLE_MARKS,
    nowIso: "2026-09-25T12:00:00.000Z",
  });
}

describe("render-model adapter", () => {
  it("should produce a valid materials.render-model.v1 in every family", () => {
    for (const family of ["signal", "dossier", "editorial"]) {
      const model = build(family);
      const result = validateRenderModel(model);
      assert.equal(result.ok, true, `${family}: ${result.errors.join("; ")}`);
      assert.equal(model.template.family, family);
      assert.equal(model.documents.resume.templateId, `${family}.resume`);
    }
  });

  it("should take identity from the writer header and classify contact lines", () => {
    const model = build();
    assert.equal(model.identity.name, "Alex Rivera");
    assert.deepEqual(model.identity.contact.map((c) => c.kind), ["location", "phone", "email", "linkedin"]);
    assert.equal(classifyContact("user@example.com").href, "mailto:user@example.com");
    assert.equal(classifyContact("example.com").kind, "site");
  });

  it("should keep every bullet's words exactly as the writer wrote them", () => {
    const model = build();
    const experience = model.documents.resume.sections.find((s) => s.kind === "experience");
    const roles = EXAMPLE_WRITER_JSON.resume.roles;
    assert.deepEqual(experience.entries.map((e) => e.org), roles.map((r) => r.company));
    experience.entries.forEach((entry, i) => {
      const expected = roles[i].bullets;
      if (entry.bullets) assert.deepEqual(entry.bullets.map((b) => runsToText(b.runs)), expected);
      else assert.equal(entry.line, expected[0]);
    });
  });

  it("should set a figure as a metric run only when the resume itself carries it, and never a year", () => {
    const runs = tagMetrics("Cut late shipments 18% in 2023 and 99% of the time.", "Cut late shipments 18% in 2023.");
    assert.deepEqual(runs.filter((r) => r.n).map((r) => r.n), ["18%"]);
    const model = build();
    const figures = JSON.stringify(model.documents.resume).match(/"n":"([^"]+)"/g).map((m) => m.slice(5, -1));
    for (const figure of figures) assert.ok(EXAMPLE_RESUME_TEXT.includes(figure), `${figure} traces to the resume`);
  });

  it("should caption readouts in the bullet's own words", () => {
    const model = build();
    const readouts = model.documents.resume.sections.find((s) => s.kind === "readouts").readouts;
    assert.ok(readouts.length >= 3 && readouts.length <= 6);
    const bulletText = JSON.stringify(EXAMPLE_WRITER_JSON.resume.roles);
    for (const r of readouts) {
      assert.ok(bulletText.includes(r.caption), `caption "${r.caption}" is verbatim`);
      assert.ok(bulletText.includes(r.n));
    }
    assert.ok(readouts.every((r) => r.employerId === "northwind-logistics" || r.employerId === "contoso-labs"));
  });

  it("should fold the letter into three or four beats and quote paragraph three verbatim", () => {
    const letter = build().documents.coverLetter;
    assert.deepEqual(letter.paragraphs.map((p) => p.beat), ["thesis", "analytics-proof", "ai-ops-proof", "next-step"]);
    assert.ok(letter.paragraphs[2].text.includes(letter.pullQuote.text));
    assert.equal(letter.pullQuote.fromParagraph, "p3");
    assert.equal(letter.salutation, "Dear hiring team,");
    assert.deepEqual(letter.rail.map((r) => r.label), ["To", "Re", "Date"]);
    const all = Object.values(EXAMPLE_WRITER_JSON.letter).join(" ");
    for (const p of letter.paragraphs) {
      for (const sentence of p.text.split(/(?<=\.)\s+/)) assert.ok(all.includes(sentence), `"${sentence}" is the writer's`);
    }
  });

  it("should attach resolver marks by employer, with their shape", () => {
    const experience = build().documents.resume.sections.find((s) => s.kind === "experience");
    assert.equal(experience.entries[0].logo.shape, "wordmark");
    assert.equal(experience.entries[1].logo.shape, "mark");
    assert.equal(experience.entries[2].logo, undefined, "no mark, no logo");
    assert.equal(matchMark(EXAMPLE_MARKS, { employerId: "x", org: "Globex" }), undefined);
  });

  it("should render the adapted model in every family with no identity from the templates", () => {
    for (const family of ["signal", "dossier", "editorial"]) {
      for (const doc of ["resume", "coverLetter"]) {
        const html = renderDocument(build(family), doc);
        assert.match(html, /Alex Rivera/);
        assert.doesNotMatch(html, /Nunez|emilio3435|501\.366|emiliobuilds/i);
      }
    }
  });

  it("should still build a renderable model from a sparse writer JSON", () => {
    const model = buildRenderModelFromWriter({
      writerJson: { letter: { hook: "One.", closing: "Two." }, resume: { roles: [{ company: "Solo Co", bullets: ["Did a thing."] }] } },
      resumeText: "Sam Example\nSolo Co\n- Did a thing.",
      family: resolveFamily("signal"),
    });
    assert.equal(model.identity.name, "Sam Example");
    assert.ok(renderDocument(model, "resume").includes("Solo Co"));
  });
});

describe("render-model adapter from pipeline draft", () => {
  const ledger = {
    contract: "materials.claim-ledger.v1",
    ledgerHash: "sha256:aa",
    employers: [
      { id: "northwind-logistics", name: "Northwind Logistics", title: "Senior Operations Analyst" },
      { id: "contoso-labs", name: "Contoso Labs", title: "Data Analyst" },
    ],
    claims: [
      { id: "resume-b1", employerId: "northwind-logistics", text: "Cut late shipments 18% by rebuilding the carrier scorecard.", metrics: [{ token: "18%" }], tools: ["SQL"] },
      { id: "resume-b2", employerId: "northwind-logistics", text: "Owned a $4.2M freight budget.", metrics: [{ token: "$4.2M" }], tools: [] },
      { id: "resume-b3", employerId: "contoso-labs", text: "Modeled demand for 140 SKUs and cut stockouts 25%.", metrics: [{ token: "140" }, { token: "25%" }], tools: ["Looker"] },
    ],
    toolInventory: [
      { tool: "SQL", level: "owned" },
      { tool: "Looker", level: "adjacent" },
    ],
  };
  const outline = {
    featured: [
      { employerId: "northwind-logistics", claimIds: ["resume-b1", "resume-b2"] },
      { employerId: "contoso-labs", claimIds: ["resume-b3"] },
    ],
    earlier: [],
    toolsLine: ["SQL", "Looker"],
    letterBeats: { thesis: "resume-b1", analyticsProof: "resume-b1", aiOpsProof: "resume-b2", nextStep: "" },
  };
  const draft = {
    contract: "materials.draft.v1",
    jdHash: "sha256:bb",
    ledgerHash: "sha256:aa",
    statement: "Operations analytics lead who turns carrier data into decisions.",
    bullets: [
      { claimId: "resume-b1", text: "Cut late shipments 18% by rebuilding the carrier scorecard around on-time pickup." },
      { claimId: "resume-b2", text: "Owned a $4.2M freight budget and moved 30% of lanes." },
      { claimId: "resume-b3", text: "Modeled demand for 140 SKUs and cut stockouts 25%." },
    ],
    earlier: [],
    letter: {
      thesis: "You are hiring someone to make a fulfillment network explain itself every Monday, and that is the job I have done for four years now.",
      analyticsProof: "At Northwind Logistics I rebuilt the carrier scorecard and cut late shipments 18% on a $4.2M freight budget with clear weekly readouts.",
      aiOpsProof: "At Contoso Labs I modeled demand for 140 SKUs and cut stockouts 25% with a Looker dashboard the floor trusted.",
      nextStep: "I would start by tracing one late order from scan to report, and I would be glad to walk through the scorecard.",
    },
  };

  function buildDraft(family = "signal") {
    return buildRenderModelFromDraft({
      draft,
      outline,
      ledger,
      resumeText: EXAMPLE_RESUME_TEXT,
      request: { company: "Acme Robotics", title: "Operations Analytics Manager" },
      family: resolveFamily(family),
      marks: EXAMPLE_MARKS,
      nowIso: "2026-09-25T12:00:00.000Z",
    });
  }

  it("should produce a valid materials.render-model.v1 from the draft in every family", () => {
    for (const family of ["signal", "dossier", "editorial"]) {
      const model = buildDraft(family);
      const result = validateRenderModel(model);
      assert.equal(result.ok, true, `${family}: ${result.errors.join("; ")}`);
    }
  });

  it("should carry real claim ids and ledger-traced metric runs", () => {
    const model = buildDraft();
    const experience = model.documents.resume.sections.find((s) => s.kind === "experience");
    assert.deepEqual(experience.entries.map((e) => e.org), ["Northwind Logistics", "Contoso Labs"]);
    assert.equal(experience.entries[0].bullets[0].claimId, "resume-b1");
    const figures = JSON.stringify(model.documents.resume).match(/"n":"([^"]+)"/g).map((m) => m.slice(5, -1));
    assert.ok(figures.includes("18%") && figures.includes("$4.2M"), `metric runs: ${figures}`);
    assert.equal(figures.includes("30%"), false, "untraced 30% is not a metric run");
  });

  it("should fold the draft letter into four beats and render both documents", () => {
    const model = buildDraft();
    assert.deepEqual(
      model.documents.coverLetter.paragraphs.map((p) => p.beat),
      ["thesis", "analytics-proof", "ai-ops-proof", "next-step"],
    );
    assert.equal(model.identity.name, "Alex Rivera");
    assert.match(renderDocument(model, "resume"), /Northwind Logistics/);
    assert.match(renderDocument(model, "coverLetter"), /Monday/);
  });
});
