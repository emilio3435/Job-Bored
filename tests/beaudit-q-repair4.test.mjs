/**
 * BEAUDIT lane Q repair round 4.
 *
 * E18: a boilerplate section (About us, Benefits ...) ends at the next
 *      heading, even one neither heading list recognises. Before, a
 *      "Job Summary" heading after "About us" stayed in the drop section and
 *      its clearance requirement was silently lost.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("E18 a drop section ends at the next unrecognised heading", () => {
  it("the reviewer's case: About us, then Job Summary keeps the clearance line", async () => {
    const { trimPostingToRequirements } = await import("../server/ats-scorecard.mjs");
    const posting =
      "About us\nAcme loves ping pong.\nJob Summary\nActive TS/SCI clearance required.\nRequirements\n5+ years of Go.";
    const out = trimPostingToRequirements(posting);
    assert.match(out, /Active TS\/SCI clearance required/);
    assert.match(out, /5\+ years of Go/);
    assert.doesNotMatch(out, /ping pong/);
  });

  for (const heading of ["## Job Summary", "**Security Clearance**", "Eligibility:", "Position Overview"]) {
    it(`'${heading}' after Benefits resets the drop section`, async () => {
      const { trimPostingToRequirements } = await import("../server/ats-scorecard.mjs");
      const posting = [
        "Requirements",
        "Kubernetes.",
        "Benefits",
        "Dental and vision coverage for the whole family.",
        heading,
        "Must be a US citizen.",
      ].join("\n");
      const out = trimPostingToRequirements(posting);
      assert.match(out, /Must be a US citizen/);
      assert.doesNotMatch(out, /Dental and vision/);
    });
  }

  it("sentence lines inside a drop section do not reset it", async () => {
    const { trimPostingToRequirements } = await import("../server/ats-scorecard.mjs");
    const posting = [
      "Requirements",
      "Go.",
      "Benefits",
      "Generous PTO.",
      "- 401k match",
      "We host team offsites twice a year",
    ].join("\n");
    const out = trimPostingToRequirements(posting);
    assert.doesNotMatch(out, /Generous PTO|401k|offsites/);
  });
});
