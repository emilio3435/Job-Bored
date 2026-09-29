import assert from "node:assert/strict";
import { it } from "node:test";

const contract = await import("../server/resume-ingest-contract.mjs").catch(() => ({}));

it("T-K5-01 validates line-pointer replies and rejects malformed ranges", () => {
  assert.equal(contract.validateReadReply?.({ employers: [{ name: "Contoso Media", headerLine: 2, roles: [], bullets: [] }] }).ok, true);
  assert.equal(contract.validateReadReply?.({ employers: [{ name: "Contoso Media", headerLine: 0, roles: [], bullets: [] }] }).ok, false);
});

it("T-K7-01 validates reconciliation coverage and named unaccounted anchors", () => {
  assert.equal(contract.validateReconciliation?.({ unaccounted: [], setAside: [], residual: [], coverage: { linesAttributed: 1, linesNonBlank: 1, anchorsAccounted: 1, anchorsTotal: 1, datedAnchorsAccounted: 1, datedAnchorsTotal: 1 }, reconciliation: { ok: true, failures: [] } }).ok, true);
  assert.equal(contract.validateReconciliation?.({ unaccounted: [], coverage: {} }).ok, false);
});

it("T-K8-01 validates IngestResult including missingEmployers and review.claims", () => {
  const result = { schema: "ingest-result/1", status: "ready_with_review", sourceMode: "text", textSha256: "a".repeat(64), originalSha256: "a".repeat(64), model: { provider: "gemini", id: "fictional" }, reads: 1, stopReasons: ["stop"], chunks: 1, anchors: 1, employers: [], unread: [{ id: "a-2", kind: "employer_header", lines: [2, 2], ck: "abc", excerpt: "Contoso Media", aliasKey: "contoso media", reason: "missing" }], setAside: [], review: { claims: [{ id: "c-1", kind: "rejected", lines: [3, 3], reason: "value_not_in_source_quote" }] }, rejected: [], carried: [], missingEmployers: [{ aliasKey: "contoso media", displayName: "Contoso Media", lines: [2, 2] }], resolutions: [], notes: [], coverage: { linesAttributed: 0, linesNonBlank: 1, anchorsAccounted: 0, anchorsTotal: 1, datedAnchorsAccounted: 0, datedAnchorsTotal: 0 }, reconciliation: { ok: true, failures: [] } };
  assert.equal(contract.validateIngestResult?.(result).ok, true);
  assert.equal(contract.validateIngestResult?.({ ...result, missingEmployers: [] }).ok, false);
});
