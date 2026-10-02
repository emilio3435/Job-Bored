/**
 * HOLES MATQ — M5: an omitted employer's reason and `justified` come from
 * what actually happened to its claims, not a hard-coded "low_relevance,
 * justified".
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { classifyC03Fixture } from "./fixtures/ingest-classify-c03.mjs";
import { ensureLedger } from "../server/materials-ledger-build.mjs";
import { scoreClaims } from "../server/materials-claim-score.mjs";
import { selectRankedClaims } from "../server/materials-select.mjs";
import { buildOutline, tenureFloorIds } from "../server/materials-outline.mjs";
import { buildRenderModelFromDraft } from "../server/materials-render-model-adapter.mjs";
import { renderPackage } from "../server/materials-package.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";

const home = mkdtempSync(join(tmpdir(), "jb-matq-omit-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.JOBBORED_PROFILE_PATH = join(home, ".jobbored", "profile.json");

const EXTRACT = { jdHash: "sha256:0", outcomes: [{ id: "o1", text: "Grow partner revenue", weight: 0.9 }], nouns: [], differentiators: [] };

function employer(id, start, end) {
  return { id, name: id.toUpperCase(), start, end };
}
const TEXTS = {
  e1: ["Negotiated carriage renewals with regional broadcast affiliates.", "Trained junior planners on audience forecasting spreadsheets."],
  e2: ["Launched a podcast sponsorship desk inside the audio group.", "Audited vendor invoices against delivered impressions monthly."],
  e3: ["Grew partner revenue through programmatic marketplace deals.", "Built a churn early-warning dashboard for account managers."],
  e4: ["Shipped self-serve onboarding for small advertisers nationwide.", "Hired and coached a team of inside sellers in Austin."],
};
function claims(id) {
  return TEXTS[id].map((text, index) => ({ id: `${id}-${index ? "b" : "a"}`, employerId: id, kind: "achievement", text, metrics: [], verified: true }));
}

describe("M5 omission reasons are derived, not hard-coded", () => {
  it("M5-1 an employer cut by the page budget is recorded as page_budget", () => {
    const ledger = {
      ledgerHash: "sha256:0",
      employers: [employer("e1", "2010", "2020"), employer("e2", "2011", "2021"), employer("e3", "2021", "2023"), employer("e4", "2024", null)],
      claims: ["e4", "e1", "e2", "e3"].flatMap(claims),
    };
    const shortlist = ledger.claims.map((claim, index) => ({ claimId: claim.id, score: { total: 1 - index / 100 }, mapsTo: ["o1"] }));
    const selection = selectRankedClaims({ extract: EXTRACT, shortlist, ledger });
    const budgetCut = new Set(selection.dropped.filter((drop) => drop.code === "budget").map((drop) => ledger.claims.find((claim) => claim.id === drop.claimId)?.employerId));
    const omitted = selection.omittedEmployers.filter((entry) => budgetCut.has(entry.employerId));
    assert.ok(omitted.length > 0, `precondition: a budget-cut employer is omitted: ${JSON.stringify(selection.omittedEmployers)}`);
    for (const entry of omitted) assert.deepEqual({ reason: entry.reason, justified: entry.justified }, { reason: "page_budget", justified: true });
  });

  it("M5-2 a retired employer stays user_retired and justified", () => {
    const ledger = {
      ledgerHash: "sha256:0",
      employers: [employer("e1", "2010", "2020"), employer("e2", "2011", "2021"), { ...employer("e3", "2021", "2023"), retired: true }, employer("e4", "2024", null)],
      claims: ["e4", "e1", "e2", "e3"].flatMap(claims),
    };
    const shortlist = ledger.claims.map((claim, index) => ({ claimId: claim.id, score: { total: 1 - index / 100 }, mapsTo: ["o1"] }));
    const selection = selectRankedClaims({ extract: EXTRACT, shortlist, ledger });
    assert.deepEqual(selection.omittedEmployers.find((entry) => entry.employerId === "e3"), { employerId: "e3", reason: "user_retired", justified: true });
  });

  it("M5-3 a featured employer that is missing before the page fit is an unjustified omission", async () => {
    const source = readFileSync(new URL("./fixtures/ingest-corpus/C03/source.txt", import.meta.url), "utf8");
    const reply = JSON.parse(readFileSync(new URL("./fixtures/ingest-corpus/C03/stage-replies/read-run2-shape.json", import.meta.url), "utf8"));
    const job = JSON.parse(readFileSync(new URL("./fixtures/ingest-corpus/C03/job-media-tech.json", import.meta.url), "utf8"));
    const ledger = await ensureLedger({ profile: null, resumeText: source, pin: { provider: "gemini", model: "fictional" }, callStage: async (request) => request.stage === "resume.classify" ? classifyC03Fixture(request) : reply });
    const shortlist = scoreClaims({ extract: job.extract, ledger, limit: 20 });
    const selection = selectRankedClaims({ extract: job.extract, shortlist, ledger });
    const outline = buildOutline({ selection, ledger, feature: "resume", extract: job.extract });
    const model = buildRenderModelFromDraft({ draft: { bullets: [], earlier: [] }, outline, ledger, resumeText: source, request: job, family: resolveFamily("signal") });
    const floor = tenureFloorIds(ledger);
    const lost = outline.featured.map((group) => group.employerId).find((id) => !floor.has(id));
    assert.ok(lost, "precondition: a featured employer outside the tenure floor");
    for (const section of model.documents.resume.sections) {
      if (Array.isArray(section.entries)) section.entries = section.entries.filter((entry) => entry.employerId !== lost);
    }
    const measure = async () => ({ fits: true, scrollHeight: 900, clientHeight: 1056, lastTextBottom: 900, limit: 1056, blockedRequests: 0 });
    const rendered = await renderPackage({ model, feature: "resume", ledger, selection, session: { measure } });
    const entry = (rendered.omittedEmployers || []).find((item) => item.employerId === lost);
    assert.ok(entry, `the lost employer is listed: ${JSON.stringify(rendered.omittedEmployers)}`);
    assert.equal(entry.justified, false);
  });
});
