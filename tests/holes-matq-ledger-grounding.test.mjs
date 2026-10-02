/**
 * HOLES MATQ — M3: profile strength evidence is model-written, so it enters
 * the claim ledger as verified only when the résumé carries it word for word
 * (as a whole line or a span of one). Anything else is verified:false and
 * can never be shortlisted, cited as tool evidence, or ground a number.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { scoreClaims } from "../server/materials-claim-score.mjs";
import { validateLedger } from "../server/materials-ledger.mjs";

const RESUME = [
  "Jordan Example",
  "SUMMARY",
  "Operator who scaled partner revenue from $ 2 M to $9M across three markets.",
  "Launched the self-serve",
  "onboarding flow — 3 weeks early.",
  "EXPERIENCE",
  "Contoso Media | Partnerships Lead | 2021 – Present",
  "• Booked $120K in new pipeline from dormant agency accounts.",
].join("\n");

const STRUCTURE = {
  source: "model",
  employers: [{
    name: "Contoso Media",
    aliases: ["contoso media"],
    start: "2021",
    end: null,
    roles: [{ title: "Partnerships Lead", start: "2021", end: null }],
    claims: [{ text: "Booked $120K in new pipeline from dormant agency accounts.", roleIndex: 0 }],
  }],
  education: [],
  credentials: [],
  looseClaims: [],
};

/** @param {Array<{ name: string, evidence: string, keywords?: string[] }>} strengths */
function ledgerWith(strengths, resumeText = RESUME) {
  return buildLedger({
    profile: { strengths: strengths.map((s, i) => ({ rank: i + 1, ...s })) },
    resumeText,
    ...(resumeText ? { structure: STRUCTURE } : {}),
    nowIso: "2026-10-02T09:00:00.000Z",
  });
}

/** @param {ReturnType<typeof buildLedger>} ledger @param {number} rank */
const strength = (ledger, rank) => ledger.claims.find((claim) => claim.id === `profile-strength-${rank}`);

describe("M3 profile evidence is verified only when the résumé carries it", () => {
  it("M3-1 evidence found verbatim in the résumé (case, spacing, split figures aside) stays verified", () => {
    const ledger = ledgerWith([{ name: "Growth", evidence: "Scaled partner revenue from $2M to $9M across three markets." }]);
    assert.equal(validateLedger(ledger).ok, true);
    assert.equal(strength(ledger, 1).verified, true);
  });

  it("M3-2 evidence that is a span of a wrapped résumé line, with other dash glyphs, stays verified", () => {
    const ledger = ledgerWith([{ name: "Launch", evidence: "launched the self‑serve onboarding flow – 3 weeks early" }]);
    assert.equal(strength(ledger, 1).verified, true);
  });

  it("M3-3 model-written evidence with an invented number is verified:false", () => {
    const ledger = ledgerWith([{ name: "Growth", evidence: "Grew partner revenue 450% in a single year at Contoso Media." }]);
    const claim = strength(ledger, 1);
    assert.ok(claim, "the strength is kept in the ledger for review");
    assert.equal(claim.verified, false);
    assert.equal(validateLedger(ledger).ok, true);
  });

  it("M3-4 a figure cut mid-token is not a verbatim match ($12 is not $120K)", () => {
    const ledger = ledgerWith([{ name: "Pipeline", evidence: "Booked $12" }]);
    assert.equal(strength(ledger, 1).verified, false);
  });

  it("M3-5 without résumé text no profile evidence is verified", () => {
    const ledger = ledgerWith([{ name: "Growth", evidence: "Scaled partner revenue from $2M to $9M across three markets." }], "");
    assert.equal(strength(ledger, 1).verified, false);
  });

  it("M3-6 unverified evidence is never shortlisted", () => {
    const ledger = ledgerWith([
      { name: "Growth", evidence: "Grew partner revenue 450% in a single year at Contoso Media." },
      { name: "Launch", evidence: "Launched the self-serve onboarding flow — 3 weeks early." },
    ]);
    const shortlist = scoreClaims({ extract: { nouns: [{ term: "partner revenue", weight: 1 }], outcomes: [], differentiators: [] }, ledger, limit: 10 });
    const ids = shortlist.map((item) => item.claimId);
    assert.ok(!ids.includes("profile-strength-1"), `unverified strength shortlisted: ${ids.join(", ")}`);
    assert.ok(ids.includes("profile-strength-2"), `verified strength missing: ${ids.join(", ")}`);
  });

  it("M3-7 a tool named only in unverified evidence is not cited as ledger evidence", () => {
    const ledger = ledgerWith([{ name: "Data", evidence: "Rebuilt every forecast in Snowflake for Contoso Media." }]);
    assert.equal(strength(ledger, 1).verified, false);
    assert.equal(ledger.toolInventory.find((entry) => entry.tool === "Snowflake"), undefined);
  });
});
