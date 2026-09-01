import assert from "node:assert/strict";
import test from "node:test";

import {
  decideIntakeMergeReview,
  matchPipelineIdentity,
  reconstructIntakeIdentityFromRow,
  sanitizeInferredEmployer,
  serializeIntakeIdentity,
  splitManualJobText,
} from "../../src/normalize/intake-identity.ts";

test("F1D-PIPE07-ID serializes canonical/provider/semantic identity for Sheet reconstruction", () => {
  const identity = serializeIntakeIdentity({
    title: "Staff Platform Engineer",
    company: "Acme Labs",
    location: "Austin, TX",
    url: "https://boards.greenhouse.io/acme/jobs/12345?utm_source=linkedin",
    sourceId: "greenhouse",
    metadata: { jobId: "12345" },
  });

  assert.equal(
    identity.canonicalUrl,
    "https://boards.greenhouse.io/acme/jobs/12345",
  );
  assert.match(identity.providerJobKey, /greenhouse:12345/);
  assert.match(identity.semanticKey, /acme/);
  assert.match(identity.semanticKey, /staff platform engineer/);
  assert.match(identity.semanticKey, /austin/);

  const row = [
    "2026-04-01",
    "Staff Platform Engineer",
    "Acme Labs",
    "Austin, TX",
    "https://boards.greenhouse.io/acme/jobs/12345",
    "Greenhouse",
  ];
  const reconstructed = reconstructIntakeIdentityFromRow(row);
  assert.equal(reconstructed.canonicalUrl, identity.canonicalUrl);
  assert.equal(reconstructed.semanticKey, identity.semanticKey);
});

test("F1D-PIPE07-ID merge review updates provider matches and reviews semantic-only collisions", () => {
  const existing = {
    title: "Staff Platform Engineer",
    company: "Acme Labs",
    location: "Austin, TX",
    url: "https://boards.greenhouse.io/acme/jobs/12345",
    sourceId: "greenhouse",
    metadata: { jobId: "12345" },
  };
  const providerMatch = matchPipelineIdentity(existing, {
    ...existing,
    url: "https://job-boards.greenhouse.io/acme/jobs/12345",
  });
  assert.equal(providerMatch.matchedOn, "provider");
  assert.equal(decideIntakeMergeReview(providerMatch).action, "update");

  const semanticOnly = matchPipelineIdentity(
    {
      title: "Staff Platform Engineer",
      company: "Acme Labs",
      location: "Austin, TX",
      url: "https://jobs.example.com/staff-platform",
      sourceId: "grounded_web",
    },
    {
      title: "Staff Platform Engineer",
      company: "Acme Labs",
      location: "Austin, TX",
      url: "https://careers.acme.test/staff-platform-engineer",
      sourceId: "grounded_web",
    },
  );
  assert.equal(semanticOnly.matchedOn, "semantic");
  assert.equal(decideIntakeMergeReview(semanticOnly).action, "review");
});

test("F1D-INGEST03-NOTES labels user-provided job text separately from personal notes", () => {
  const split = splitManualJobText({
    description: "Own reliability for the hiring loop.",
    notes: "Recruiter is Dana.",
  });
  assert.equal(split.notes, "Recruiter is Dana.");
  assert.match(split.jobText, /user-provided job (description|text)/i);
  assert.match(split.jobText, /hiring loop/);
  assert.doesNotMatch(split.notes, /hiring loop/);
});

test("F1D-INGEST04-HOST rejects Careers/Linkedin host placeholders", () => {
  assert.equal(
    sanitizeInferredEmployer("Careers", "https://careers.example.com/jobs/1"),
    "",
  );
  assert.equal(
    sanitizeInferredEmployer("Linkedin", "https://www.linkedin.com/jobs/view/9"),
    "",
  );
  assert.equal(
    sanitizeInferredEmployer("Acme Labs", "https://careers.example.com/jobs/1"),
    "Acme Labs",
  );
});
