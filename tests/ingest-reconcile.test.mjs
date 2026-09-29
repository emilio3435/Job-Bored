import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const read = await import("../server/materials-resume-structure-model.mjs");
const reconcile = await import("../server/resume-ingest-reconcile.mjs").catch(() => ({}));
const { censusResume } = await import("../server/resume-ingest-census.mjs");
const PIN = { provider: "gemini", model: "fictional", resolvedModel: "fictional", apiKey: "fictional" };
const SOURCE = readFileSync(new URL("./fixtures/ingest-corpus/C03/source.txt", import.meta.url), "utf8");
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/ingest-corpus/C03/stage-replies/${name}.json`, import.meta.url), "utf8"));
const run = (source, replies) => { let calls = 0; const prompts = []; return read.structureResume?.({ lsrc: source, pin: PIN, callStage: async (request) => { prompts.push(request.userText); return replies[Math.min(calls++, replies.length - 1)]; } }).then((result) => ({ result, calls, prompts })); };

it("T-K7-02 closes or exposes all four anchor kinds", async () => {
  const { result } = await run(SOURCE, [fixture("read-full")]);
  assert.equal(result.reconciliation.ok, true);
  assert.equal(result.coverage.anchorsAccounted, result.coverage.anchorsTotal);
});
it("T-K7-03 an unaccounted dated anchor triggers a repair read", async () => {
  const { calls } = await run(SOURCE, [fixture("read-run6-shape"), fixture("read-full")]);
  assert.equal(calls, 2);
});
it("T-K7-04 a still unaccounted dated anchor is visible and partial", async () => {
  const { result } = await run(SOURCE, [fixture("read-run6-shape"), fixture("read-run6-shape")]);
  assert.equal(result.status, "ready_with_review");
  assert.ok(result.unread.some((item) => item.kind === "date_range"));
});
it("T-K7-05 run 6 lists both missing employers by alias key", async () => {
  const { result } = await run(SOURCE, [fixture("read-run6-shape"), fixture("read-run6-shape")]);
  assert.equal(result.status, "ready_with_review");
  for (const key of ["northwind trading", "tailspin studio"]) {
    assert.ok(result.unread.some((item) => item.aliasKey === key));
    assert.ok(result.missingEmployers.some((item) => item.aliasKey === key));
  }
});
it("T-K7-06 reports C03 coverage counts", async () => {
  const { result } = await run(SOURCE, [fixture("read-full")]);
  assert.equal(result.coverage.anchorsTotal, 12);
  assert.equal(result.coverage.datedAnchorsTotal, 7);
});
it("T-K7-07 line overlap without alias match does not close a header", () => {
  assert.equal(reconcile.employerKey?.("Contoso Media — contoso.example"), "contoso media");
  assert.equal(reconcile.employerKey?.("Contoso Media (contoso.example)"), "contoso media");
  assert.notEqual(reconcile.employerKey?.("Fabrikam Labs"), reconcile.employerKey?.("Contoso Media"));
});
it("T-K7-08 out-of-span Fabrikam claims are quarantined while Northwind claims stay there", async () => {
  const reply = fixture("read-full");
  reply.employers[1].claims.push(...reply.employers[2].claims.splice(0, 2));
  const { result } = await run(SOURCE, [reply]);
  assert.ok(result.review.claims.some((item) => item.kind === "inferred" && item.lines[0] === 14));
  assert.equal(result.status, "ready", "grounded, quarantined claim lines count toward coverage without entering the candidate pool");
  assert.equal(result.unread.some((item) => item.kind === "residual" && item.lines[0] === 14), false);
  assert.ok(result.employers.some((item) => item.name === "Northwind Trading"));
});
it("T-K7-09 a two-line residual block is visible and partial", async () => {
  const reply = fixture("read-full"); reply.employers[2].claims = [];
  const { result } = await run(SOURCE, [reply, reply]);
  assert.equal(result.status, "ready_with_review");
  assert.ok(result.unread.some((item) => item.kind === "residual"));

  const prefix = [
    "Jordan Rivera",
    "Audience analytics and operations leader",
    "Springfield, IL • 555-010-2345 • jordan@example.com • jordan.example",
    "SUMMARY",
    "Experienced research leader.",
    "EXPERIENCE",
    "Contoso Media — contoso.example",
    "Jan 2020 – Present • Research Lead",
    "Built audience research systems for local teams.",
    "— Jordan Rivera • Audience operations • jordan.example",
    "Jordan Rivera",
    "Audience analytics and operations leader",
    "Springfield, IL • 555-010-2345 • jordan@example.com • jordan.example",
  ];
  const employer = { name: "Contoso Media", lines: [7, 7], roles: [{ title: "Research Lead", start: "2020-01", end: "present", lines: [8, 8] }], claims: [{ text: prefix[8], lines: [9, 9] }] };
  const withoutBullet = prefix.join("\n");
  const chromeOnly = reconcile.reconcileRead({ lsrc: withoutBullet, census: censusResume(withoutBullet), employers: [employer] });
  assert.deepEqual(chromeOnly.residual, [], "repeated page identity and contact lines are chrome");
  assert.equal(chromeOnly.reconciliation.ok, true);

  const withBullet = [...prefix, "Led account reviews in Springfield for three neighborhood teams.", "Prepared buyer notes for the next field meeting."].join("\n");
  const withRealWork = reconcile.reconcileRead({ lsrc: withBullet, census: censusResume(withBullet), employers: [employer] });
  assert.deepEqual(withRealWork.residual.map((item) => item.lines), [[14, 15]], "city mentions in real experience stay visible");
});
it("T-K7-10 model non_job on a dated experience anchor is set aside and partial", async () => {
  const reply = fixture("read-full"); reply.nonJob = [{ lines: [34, 34], reason: "user_asserted" }]; reply.employers.pop();
  const { result } = await run(SOURCE, [reply, reply]);
  assert.equal(result.status, "ready_with_review");
  assert.ok(result.setAside.some((item) => item.lines[0] === 34));
});
it("T-K7-11 merged dated roles leave the extra anchor unread", async () => {
  const reply = fixture("read-full"); reply.employers[0].roles.splice(1, 1);
  const { result } = await run(SOURCE, [reply, reply]);
  assert.equal(result.status, "ready_with_review");
  assert.ok(result.unread.some((item) => item.lines[0] === 9 && item.kind === "date_range"));
});
it("T-K7-12 same normalized company on different dated blocks stays separate", async () => {
  const source = "EXPERIENCE\nAcme Inc\n2019 — 2020\nAcme LLC\n2021 — 2022";
  const raw = { employers: [{ name: "Acme Inc", lines: [2, 2], roles: [], claims: [] }, { name: "Acme LLC", lines: [4, 4], roles: [], claims: [] }] };
  const { result } = await run(source, [raw]);
  assert.equal(result.employers.length, 2);
  assert.equal(reconcile.employerKey("Acme Inc"), reconcile.employerKey("Acme LLC"));
});
it("T-K7-13 unexplained experience coverage gap cannot be ready", async () => {
  const reply = fixture("read-full"); reply.employers[2].claims = [];
  const { result } = await run(SOURCE, [reply, reply]);
  assert.notEqual(result.status, "ready");
  assert.ok(result.reconciliation.failures.includes("reconciliation_failed") || result.unread.some((item) => item.kind === "residual"));
});
