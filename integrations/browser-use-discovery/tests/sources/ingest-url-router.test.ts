import assert from "node:assert/strict";
import test from "node:test";

import { classifyIngestUrl } from "../../src/sources/ingest-url-router.ts";

test("classifyIngestUrl classifies ats_direct greenhouse", () => {
  const result = classifyIngestUrl(
    "https://boards.greenhouse.io/plaid/jobs/4728292004",
  );
  assert.equal(result.kind, "ats_direct");
  if (result.kind !== "ats_direct") return;
  assert.equal(result.provider, "greenhouse");
  assert.equal(result.slug, "plaid");
  assert.equal(result.jobId, "4728292004");
});

test("classifyIngestUrl classifies ats_direct lever", () => {
  const result = classifyIngestUrl("https://jobs.lever.co/stripe/abc-123");
  assert.equal(result.kind, "ats_direct");
  if (result.kind !== "ats_direct") return;
  assert.equal(result.provider, "lever");
  assert.equal(result.slug, "stripe");
  assert.equal(result.jobId, "abc-123");
});

test("classifyIngestUrl classifies ats_direct ashby", () => {
  const result = classifyIngestUrl("https://jobs.ashbyhq.com/figma/a1b2c3");
  assert.equal(result.kind, "ats_direct");
  if (result.kind !== "ats_direct") return;
  assert.equal(result.provider, "ashby");
  assert.equal(result.slug, "figma");
  assert.equal(result.jobId, "a1b2c3");
});

test("classifyIngestUrl classifies blocked linkedin URL", () => {
  const result = classifyIngestUrl(
    "https://www.linkedin.com/jobs/view/4369653076",
  );
  assert.equal(result.kind, "blocked_aggregator");
  if (result.kind !== "blocked_aggregator") return;
  assert.equal(result.provider, "linkedin");
});

test("classifyIngestUrl classifies blocked indeed URL", () => {
  const result = classifyIngestUrl("https://www.indeed.com/viewjob?jk=abc");
  assert.equal(result.kind, "blocked_aggregator");
  if (result.kind !== "blocked_aggregator") return;
  assert.equal(result.provider, "indeed");
});

test("classifyIngestUrl classifies generic https URL", () => {
  const result = classifyIngestUrl(
    "https://www.notion.so/careers/product-marketing-manager",
  );
  assert.equal(result.kind, "generic_https");
});

test("classifyIngestUrl classifies private network URL", () => {
  const result = classifyIngestUrl("http://127.0.0.1:3000/api");
  assert.equal(result.kind, "private_network");
});

test("classifyIngestUrl rejects invalid URL", () => {
  const result = classifyIngestUrl("not-a-url");
  assert.equal(result.kind, "invalid");
});

test("classifyIngestUrl rejects URL with userinfo", () => {
  const result = classifyIngestUrl("http://user:pass@example.com/");
  assert.equal(result.kind, "invalid");
});
