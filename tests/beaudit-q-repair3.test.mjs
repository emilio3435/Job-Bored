/**
 * BEAUDIT lane Q repair round 3.
 *
 * E18: trimming the ATS posting drops only boilerplate sections (About us,
 *      Benefits, EEO ...). Text under an unrecognised heading such as
 *      "Job Summary", or before the first heading, carries hiring
 *      requirements too and stays within the budget; recognised requirement
 *      sections win when the budget is tight.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("E18 posting trim keeps text under unrecognised headings", () => {
  it("a TS/SCI line under 'Job Summary' survives when a Requirements heading follows", async () => {
    const { trimPostingToRequirements } = await import("../server/ats-scorecard.mjs");
    const posting = [
      "Job Summary",
      "Build ground-control software for satellite operators.",
      "Active TS/SCI clearance with polygraph required.",
      "Requirements",
      "5+ years of Go.",
      "Benefits",
      "Unlimited snacks.",
    ].join("\n");
    const out = trimPostingToRequirements(posting);
    assert.match(out, /TS\/SCI clearance with polygraph required/);
    assert.match(out, /ground-control software/);
    assert.match(out, /5\+ years of Go/);
    assert.doesNotMatch(out, /Unlimited snacks/);
  });

  it("text before the first heading survives", async () => {
    const { trimPostingToRequirements } = await import("../server/ats-scorecard.mjs");
    const posting = [
      "US citizenship required for this position.",
      "Qualifications",
      "Kubernetes.",
    ].join("\n");
    assert.match(trimPostingToRequirements(posting), /US citizenship required/);
  });

  it("under a tight budget the requirement sections win and the whole stays bounded", async () => {
    const { trimPostingToRequirements } = await import("../server/ats-scorecard.mjs");
    const posting = [
      "Job Summary",
      ...Array.from({ length: 200 }, (_, i) => `Summary line ${i} about the mission and the team.`),
      "Requirements",
      "- Must hold an active Secret clearance.",
      "- 5+ years of Go.",
    ].join("\n");
    const out = trimPostingToRequirements(posting);
    assert.match(out, /Must hold an active Secret clearance/);
    assert.match(out, /5\+ years of Go/);
    assert.match(out, /Summary line 0 about the mission/);
    assert.ok(out.length <= 4_100, `trimmed posting is ${out.length} chars`);
  });
});
