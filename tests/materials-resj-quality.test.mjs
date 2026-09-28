/**
 * RESJ-QUALITY follow-ups (docs/programs/resj-20260927/reports/
 * LANE-REPORT-RESJ-QUALITY.md):
 *   Q2  every run records the resume, ledger and posting it drafted from,
 *       and keeps a copy of resume-source.json beside the run;
 *   Q3  jd-extract.json keeps why the model fill degraded and how much
 *       evidence it carries; the gate's confidence comes from the
 *       posting's structure, not its word count;
 *   Q4  selection.json records per-outcome proof coverage and the count
 *       of drops by reason, and the claims.select stage names both;
 *   the Settings copy proposes a fallback model without setting one.
 * No live model calls.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { deterministicExtract, extractQuality, jdEvidence } from "../server/materials-jd-extract.mjs";
import { validateRunRecord } from "../server/materials-package.mjs";
import { runInputs, runPipeline } from "../server/materials-pipeline.mjs";
import { validateSelection } from "../server/materials-select.mjs";

const NORTHWIND_JD = readFileSync(new URL("./fixtures/jobs/northwind-director-digital-sales.txt", import.meta.url), "utf8");
const GATE = { verdict: "usable", confidence: 0.9, signals: {} };
const RESUME = "Example Person\nDigital Sales Leader\nuser@example.com\n";

const LEDGER = {
  contract: "materials.claim-ledger.v1",
  ledgerHash: "sha256:abc123",
  builderVersion: 4,
  employers: [
    { id: "acme", name: "Acme Media", start: "2019", end: "2026" },
    { id: "beta", name: "Beta Labs", start: "2024", end: null },
  ],
  claims: [
    { id: "a1", employerId: "acme", kind: "achievement", text: "Guided online plan for a $12M+ yearly portfolio of streaming audio and CTV campaigns.", metrics: [{ token: "$12M+" }], verified: true },
    { id: "a2", employerId: "acme", kind: "operations", text: "Coached 12 AE desks through integrated campaign pitches across the region.", metrics: [{ token: "12" }], verified: true },
    { id: "a3", employerId: "acme", kind: "achievement", text: "Grew digital revenue to 60% of the market's total through podcast and streaming sales.", metrics: [{ token: "60%" }], verified: true },
    { id: "b1", employerId: "beta", kind: "system", text: "Shipped a revenue forecast tool running 24+ forecasts against $3.1M of pipeline.", metrics: [{ token: "24+" }, { token: "$3.1M" }], verified: true },
  ],
  toolInventory: [],
};

describe("Q3: posting evidence, not word count", () => {
  it("should score a structured posting above a long unstructured one of the same length", () => {
    const structured = jdEvidence(NORTHWIND_JD);
    assert.ok(structured.roleSections >= 1 && structured.dutyLines >= 5, JSON.stringify(structured));
    assert.ok(structured.companyFacts >= 1);
    const words = NORTHWIND_JD.split(/\s+/).length;
    const filler = Array.from({ length: words }, (_, i) => (i % 12 === 11 ? "benefits." : "benefits")).join(" ");
    const flat = jdEvidence(filler);
    assert.ok(flat.words >= structured.words - 5, "same length");
    assert.ok(flat.confidence < structured.confidence, `${flat.confidence} < ${structured.confidence}`);
    assert.ok(structured.confidence <= 0.95);
  });

  it("should count the evidence an extract carries and mark a degraded fill", () => {
    const ex = deterministicExtract({ jdText: NORTHWIND_JD, company: "NorthwindMedia, Inc.", title: "Director, Digital Sales", gate: GATE });
    const good = extractQuality(ex, false);
    const bad = extractQuality(ex, true);
    assert.equal(good.outcomes, ex.outcomes.length);
    assert.equal(good.companyFacts, ex.companyFacts.length);
    assert.ok(bad.score < good.score, "a degraded fill scores lower");
    const empty = extractQuality({ outcomes: [], nouns: [] }, true);
    assert.equal(empty.score, 0);
  });
});

describe("Q2, Q3, Q4 through the pipeline", () => {
  it("should record inputs, keep the extract's degradation reason, and log coverage and drop reasons", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-resj-quality-"));
    try {
      /* The drafter writes the app-level snapshot before the run. */
      writeFileSync(join(dir, "resume-source.json"), JSON.stringify({ source: "file", filename: "resume.txt", addedAt: "2026-09-27T00:00:00.000Z", text: RESUME }));
      const out = await runPipeline({
        dir,
        payload: { slug: "acme", company: "NorthwindMedia, Inc.", title: "Director, Digital Sales", feature: "resume", jobUrl: "", notes: "", resume: { source: "file", filename: "resume.txt", addedAt: "2026-09-27T00:00:00.000Z", text: RESUME } },
        pin: null,
        fetchImpl: async () => {
          throw new Error("no calls");
        },
        jdText: NORTHWIND_JD,
        jdSource: "cache",
        gate: { verdict: "usable", confidence: 0.9, signals: { words: 900, roleSections: 2, requirementSections: 2, dutyLines: 8, companyFacts: 3 } },
        ledger: LEDGER,
        resumeText: RESUME,
        now: new Date("2026-09-27T00:00:00.000Z"),
        runId: "run-resj-quality",
        openSession: async () => null,
      });
      assert.equal(out.outcome, "published");

      /* Q2 */
      const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8"));
      assert.equal(validateRunRecord(run).ok, true, JSON.stringify(validateRunRecord(run).errors));
      assert.equal(run.inputs.resume.chars, RESUME.length);
      assert.match(run.inputs.resume.hash, /^sha256:[0-9a-f]{16}$/);
      assert.deepEqual(run.inputs.ledger, { hash: "sha256:abc123", claims: 4, employers: 2, builderVersion: 4 });
      assert.equal(run.inputs.jd.source, "cache");
      assert.ok(run.inputs.jd.words > 500);
      assert.ok(existsSync(join(dir, "runs", "run-resj-quality", "resume-source.json")), "the resume used is kept beside the run");

      /* Q3 */
      const extract = JSON.parse(await readFile(join(dir, "jd-extract.json"), "utf8"));
      assert.deepEqual(extract.degraded, { code: "no_pin", reason: "no model configured" });
      assert.equal(typeof extract.quality.score, "number");
      const prepare = run.stages.find((/** @type {{ stage: string }} */ s) => s.stage === "prepare");
      assert.match(prepare.detail, /2 role section\(s\), 8 duty line\(s\), 2 requirements block\(s\), 3 company fact\(s\)/);
      assert.match(prepare.detail, /evidence \d/);

      /* Q4 */
      const selection = JSON.parse(await readFile(join(dir, "selection.json"), "utf8"));
      assert.equal(validateSelection(selection).ok, true, JSON.stringify(validateSelection(selection).errors));
      assert.equal(selection.coverage.length, extract.outcomes.length);
      for (const row of selection.coverage) assert.ok(Array.isArray(row.claimIds));
      assert.equal(typeof selection.dropTally, "object");
      assert.match(prepare.detail, /outcomes \S+:\d/);
      assert.match(prepare.detail, /drops (?:\S+:\d|none)/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should fingerprint inputs without a resume", () => {
    const inputs = runInputs({ resumeText: "", ledger: { ledgerHash: "sha256:1", claims: [], employers: [] }, jdHash: "sha256:2", jdText: "a b c", jdSource: "paste" });
    assert.equal(inputs.resume, undefined);
    assert.deepEqual(inputs.jd, { hash: "sha256:2", words: 3, source: "paste" });
  });
});

describe("Settings copy: a fallback model is proposed, never set", () => {
  it("should explain 429/503 and where a fallback goes, without a control that sets one", () => {
    const html = readFileSync(new URL("../partials/settings-modal.html", import.meta.url), "utf8");
    const at = html.indexOf('id="settingsGeminiFallbackHint"');
    assert.ok(at > 0);
    const hint = html.slice(at, html.indexOf("</p>", at));
    assert.match(hint, /429/);
    assert.match(hint, /503/);
    assert.match(hint, /fallback/);
    assert.match(hint, /Nothing is set for you/);
    assert.doesNotMatch(hint, /<(input|select|button)\b/);
  });
});
