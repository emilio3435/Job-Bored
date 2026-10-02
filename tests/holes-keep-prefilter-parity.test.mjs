// HOLES KEEP R2/R9/R10: discovery and rescore must make the same pre-filter
// decision about the same job. One shared fixture runs through the worker's
// lead-normalizer and profile-aware-scorer and the server's rescore worker.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { inferRemoteBucket } from "../integrations/browser-use-discovery/src/normalize/lead-normalizer.ts";
import {
  parseSalaryMax as workerParseSalaryMax,
  runPreFilter as workerRunPreFilter,
} from "../integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts";
import { _internal as rescore } from "../server/profile-rescore-worker.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/holes-keep/prefilter-parity.json", import.meta.url), "utf8"),
);

function profile(hardConstraints) {
  return {
    version: 1,
    identity: { targetRoles: ["Engineer"], targetSeniority: "ic_senior", primaryNarrative: "x" },
    strengths: [{ name: "backend", rank: 1 }],
    hardConstraints: { workMode: "any", ...hardConstraints },
  };
}

/** The rescore worker reads a Pipeline row (A..Z); this builds one. */
function sheetRow({ title = "Senior Engineer", location = "", salary = "", workMode = "" }) {
  const row = new Array(26).fill("");
  row[1] = title;
  row[2] = "Acme";
  row[3] = location;
  row[4] = "https://jobs.example.com/4012";
  row[6] = salary;
  row[25] = workMode;
  return row;
}

function rescoreDecision(rowInput, description, hardConstraints) {
  const listing = rescore.buildRawListingFromRow(sheetRow(rowInput));
  listing.descriptionText = description || "";
  return rescore.runPreFilter(listing, profile(hardConstraints));
}

function discoveryDecision(listingInput, hardConstraints) {
  return workerRunPreFilter(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      company: "Acme",
      url: "https://jobs.example.com/4012",
      title: "Senior Engineer",
      ...listingInput,
    },
    profile(hardConstraints),
  );
}

function outcome(result) {
  return result.pass ? "pass" : result.reason;
}

describe("R2: rescore infers remote the way discovery does", () => {
  for (const c of fixture.remoteBucket) {
    const name = `${c.location || "(blank)"} / ${c.title}${c.description ? " / description" : ""}${c.workMode ? ` / Z=${c.workMode}` : ""}`;
    it(`${name} -> ${c.expected}`, () => {
      assert.equal(
        inferRemoteBucket({
          remoteBucket: c.workMode,
          location: c.location,
          title: c.title,
          descriptionText: c.description,
        }),
        c.expected,
        "lead-normalizer",
      );
      const remoteOnly = { workMode: "remote_only" };
      const worker = discoveryDecision(
        { location: c.location, title: c.title, descriptionText: c.description, remoteBucket: c.workMode },
        remoteOnly,
      );
      const server = rescoreDecision(
        { location: c.location, title: c.title, workMode: c.workMode },
        c.description,
        remoteOnly,
      );
      const expected = c.expected === "remote" ? "pass" : "work_mode_mismatch";
      assert.equal(outcome(worker), expected, "profile-aware-scorer");
      assert.equal(outcome(server), expected, "profile-rescore-worker");
      if (!worker.pass) assert.equal(worker.remoteBucket, c.expected, "scorer bucket");
      if (!server.pass) assert.equal(server.remoteBucket, c.expected, "rescore bucket");
    });
  }
});

describe("R9: both scorers read the same annual salary", () => {
  for (const c of fixture.salaryMax) {
    it(`${JSON.stringify(c.text)} -> ${c.expected}`, () => {
      assert.equal(workerParseSalaryMax(c.text), c.expected, "profile-aware-scorer");
      assert.equal(rescore.parseSalaryMax(c.text), c.expected, "profile-rescore-worker");
      const floor = { salaryFloor: 100_000, salaryRequired: true };
      const expected =
        c.expected === null ? "salary_missing_but_required" : c.expected < 100_000 ? "salary_below_floor" : "pass";
      assert.equal(outcome(discoveryDecision({ compensationText: c.text }, floor)), expected, "scorer pre-filter");
      assert.equal(outcome(rescoreDecision({ salary: c.text }, "", floor)), expected, "rescore pre-filter");
    });
  }
});

describe("R10: skip titles and acceptable locations match whole words", () => {
  for (const c of fixture.skipTitles) {
    it(`skip ${JSON.stringify(c.skip)} vs ${JSON.stringify(c.title)} -> ${c.expected}`, () => {
      const hc = { skipTitles: c.skip };
      assert.equal(outcome(discoveryDecision({ title: c.title }, hc)), c.expected, "profile-aware-scorer");
      assert.equal(outcome(rescoreDecision({ title: c.title }, "", hc)), c.expected, "profile-rescore-worker");
    });
  }
  for (const c of fixture.acceptableLocations) {
    it(`accept ${JSON.stringify(c.acceptable)} vs ${JSON.stringify(c.location)} -> ${c.expected}`, () => {
      for (const workMode of ["hybrid_ok", "onsite_ok"]) {
        const hc = { workMode, acceptableLocations: c.acceptable };
        assert.equal(outcome(discoveryDecision({ location: c.location }, hc)), c.expected, `scorer ${workMode}`);
        assert.equal(outcome(rescoreDecision({ location: c.location }, "", hc)), c.expected, `rescore ${workMode}`);
      }
    });
  }
});
