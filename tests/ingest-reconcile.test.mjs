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

  const source = ["EXPERIENCE", "Contoso Media (formerly Litware Radio)", "Jan 2022 — Present • Research Lead", "Built a planning tool for local teams."].join("\n");
  const employer = { name: "Contoso Media", aliasClause: "(formerly Litware Radio)", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2022", end: "Present", lines: [3, 3] }], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] };
  const covered = await run(source, [{ employers: [employer] }]);
  assert.equal(covered.result.status, "ready", "a grounded parenthesized formerly clause closes its anchor");
  assert.equal(covered.calls, 1, "the covered clause does not spend the repair read");
  assert.equal(covered.result.unread.some((item) => item.kind === "formerly_clause"), false);
  const formerOnly = await run(source, [{ employers: [{ ...employer, name: "Litware Radio" }] }, { employers: [{ ...employer, name: "Litware Radio" }] }]);
  assert.equal(formerOnly.result.status, "ready_with_review", "the former name cannot impersonate the parent employer");
  assert.ok(formerOnly.result.missingEmployers.some((item) => item.aliasKey === "contoso media"));
});
it("T-K7-03 an unaccounted dated anchor triggers a repair read", async () => {
  const { calls } = await run(SOURCE, [fixture("read-run6-shape"), fixture("read-full")]);
  assert.equal(calls, 2);
  const first = fixture("read-full");
  first.employers[0].roles.splice(1, 1);
  first.employers[2].claims.splice(0, 1);
  const repaired = await run(SOURCE, [first, fixture("read-full")]);
  assert.equal(repaired.calls, 2);
  assert.equal(repaired.result.employers[0].roles.length, 3, "the repair adds the missing role to an accepted employer");
  assert.equal(repaired.result.employers[2].claims.length, fixture("read-full").employers[2].claims.length, "the repair adds its grounded claim");
  assert.equal(repaired.result.unread.some((item) => item.lines[0] === 9), false);
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
  const source = ["Jordan Rivera", "Audience operations leader", "Springfield, IL • 555-010-2345 • jordan@example.com", "EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • Research Lead", "Built a planning tool for local teams.", "Jordan Rivera", "2018 — 2019"].join("\n");
  const employer = { name: "Contoso Media", lines: [5, 5], roles: [{ title: "Research Lead", start: "Jan 2020", end: "Present", lines: [6, 6] }], claims: [{ text: "Built a planning tool for local teams.", lines: [7, 7] }] };
  const hidden = await run(source, [{ employers: [employer] }, { employers: [employer] }]);
  assert.ok(hidden.result.missingEmployers.some((item) => item.aliasKey === "jordan rivera" && item.lines[0] === 8), "chrome cannot erase a census employer header");
});
it("T-K7-07 line overlap without alias match does not close a header", async () => {
  assert.equal(reconcile.employerKey?.("Contoso Media — contoso.example"), "contoso media");
  assert.equal(reconcile.employerKey?.("Contoso Media (contoso.example)"), "contoso media");
  assert.equal(reconcile.employerKey?.("Contoso Media (formerly Litware Radio)"), "contoso media");
  assert.notEqual(reconcile.employerKey?.("Fabrikam Labs"), reconcile.employerKey?.("Contoso Media"));

  const source = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2022 — Present • Research Lead", "Built a planning tool for local teams."].join("\n");
  const employer = { name: "Contoso Media — contoso.example", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2022", end: "Present", lines: [3, 3] }], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] };
  const matched = await run(source, [{ employers: [employer] }]);
  assert.equal(matched.result.status, "ready", "a grounded model name with a site suffix closes the matching header");
  assert.deepEqual(matched.result.missingEmployers, []);
  const unsupported = await run(source, [{ employers: [{ ...employer, name: "Fabrikam Labs — fabrikam.example" }] }, { employers: [{ ...employer, name: "Fabrikam Labs — fabrikam.example" }] }]);
  assert.equal(unsupported.result.status, "ready_with_review");
  assert.ok(unsupported.result.missingEmployers.some((item) => item.aliasKey === "contoso media"), "a site suffix does not legitimize a different employer");
});
it("T-K7-08 out-of-span Fabrikam claims are quarantined while Northwind claims stay there", async () => {
  const reply = fixture("read-full");
  reply.employers[1].claims.push(...reply.employers[2].claims.splice(0, 2));
  const { result } = await run(SOURCE, [reply]);
  assert.ok(result.review.claims.some((item) => item.kind === "inferred" && item.lines[0] === 14));
  assert.equal(result.status, "ready", "grounded, quarantined claim lines count toward coverage without entering the candidate pool");
  assert.equal(result.unread.some((item) => item.kind === "residual" && item.lines[0] === 14), false);
  const northwind = result.employers.find((item) => item.name === "Northwind Trading");
  assert.ok(northwind);
  assert.ok(northwind.claims.some((claim) => claim.lines[0] === 14 && claim.attribution === "inferred" && claim.quarantined === true), "a grounded foreign claim is re-homed but quarantined");
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

  const foldedCopy = [...prefix.slice(0, 9), "Jordan  Rivera", prefix[1], prefix[2]].join("\n");
  const foldedHeader = reconcile.reconcileRead({ lsrc: foldedCopy, census: censusResume(foldedCopy), employers: [employer] });
  assert.equal(foldedHeader.reconciliation.ok, true, "a folded identity copy is accounted as chrome");

  const withBullet = [...prefix, "Led account reviews in Springfield for three neighborhood teams.", "Prepared buyer notes for the next field meeting."].join("\n");
  const withRealWork = reconcile.reconcileRead({ lsrc: withBullet, census: censusResume(withBullet), employers: [employer] });
  assert.deepEqual(withRealWork.residual.map((item) => item.lines), [[14, 15]], "city mentions in real experience stay visible");

  const withYearRange = [...prefix.slice(0, 7), "2017 - 2026"].join("\n");
  const datedWork = reconcile.reconcileRead({ lsrc: withYearRange, census: censusResume(withYearRange), employers: [{ ...employer, roles: [], claims: [] }] });
  assert.ok(datedWork.unaccounted.some((item) => item.kind === "date_range" && item.lines[0] === 8), "an ungrounded year range stays visible");

  const splitRun = [...prefix.slice(0, 9), "Shipped the weekly planning tool for neighborhood teams.", "Jordan Rivera", "Opened regional reporting for neighborhood managers.", "", "2018 — 2019"].join("\n");
  const split = reconcile.reconcileRead({ lsrc: splitRun, census: censusResume(splitRun), employers: [employer] });
  assert.ok(split.unaccounted.some((item) => item.kind === "date_range" && item.lines[0] === 14));
  assert.ok(split.residual.some((item) => item.lines[0] === 10 && item.lines[1] === 12), "a chrome line cannot split two unclaimed work lines");
});
it("T-K7-10 model non_job employer anchors stay partial while date notes do not", async () => {
  const reply = fixture("read-full"); reply.nonJob = [{ lines: [34, 34], reason: "user_asserted" }];
  const { result } = await run(SOURCE, [reply, reply]);
  assert.equal(result.status, "ready_with_review");
  assert.ok(result.setAside.some((item) => item.lines[0] === 34));
  assert.ok(result.missingEmployers.some((item) => item.lines[0] === 34));

  const source = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2022 — Present • Research Lead", "Built a planning tool for local teams.", "2018 — 2019 • background tenure note"].join("\n");
  const complete = { employers: [{ name: "Contoso Media", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2022", end: "Present", lines: [3, 3] }], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] }], nonJob: [{ lines: [5, 5], reason: "background note, not a separate role" }] };
  const claimsOnly = await run(source, [complete]);
  assert.equal(claimsOnly.result.status, "ready", "claim-level set-asides do not make a complete read partial");
  assert.ok(claimsOnly.result.setAside.some((item) => item.lines[0] === 5));
  assert.ok(claimsOnly.result.review.claims.length > 0, "claim review records remain visible");
  const missing = await run(source, [{ ...complete, employers: [] }, { ...complete, employers: [] }]);
  assert.equal(missing.result.status, "ready_with_review", "a genuinely missing employer still blocks ready");
  assert.ok(missing.result.missingEmployers.some((item) => item.aliasKey === "contoso media"));
  const falseNonJob = { employers: [], nonJob: [{ lines: [2, 2], reason: "not a job" }, { lines: [3, 3], reason: "not a role" }, { lines: [5, 5], reason: "background note" }] };
  const hiddenEmployer = await run(source, [falseNonJob, falseNonJob]);
  assert.equal(hiddenEmployer.result.status, "ready_with_review", "a model non_job label cannot hide an employer header");
  assert.ok(hiddenEmployer.result.missingEmployers.some((item) => item.aliasKey === "contoso media"));

  const roleSource = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • Research Lead", "Built a planning tool for local teams.", "May 2019 — May 2021 • Senior Account Executive"].join("\n");
  const roleReply = { employers: [{ name: "Contoso Media", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2020", end: "Present", lines: [3, 3] }], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] }], nonJob: [{ lines: [5, 5], reason: "not another role" }] };
  const roleGap = await run(roleSource, [roleReply, roleReply]);
  assert.equal(roleGap.result.status, "ready_with_review", "a non_job label cannot silently clear a dated role header");
  assert.ok(roleGap.result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 5));
  assert.ok(roleGap.result.setAside.some((item) => item.lines[0] === 5));
  assert.ok(roleGap.result.review.claims.some((item) => item.lines[0] === 5));
});
it("T-K7-11 merged dated roles leave the extra anchor unread", async () => {
  const reply = fixture("read-full"); reply.employers[0].roles.splice(1, 1);
  const { result } = await run(SOURCE, [reply, reply]);
  assert.equal(result.status, "ready_with_review");
  assert.ok(result.unread.some((item) => item.lines[0] === 9 && item.kind === "date_range"));
  const duplicateDates = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • Research Lead", "Built a planning tool for local teams.", "Jan 2020 — Present • Sales Manager"].join("\n");
  const oneRole = { employers: [{ name: "Contoso Media", start: "Jan 2020", end: "Present", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2020", end: "Present", lines: [3, 3] }], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] }] };
  const duplicate = await run(duplicateDates, [oneRole, oneRole]);
  assert.equal(duplicate.result.status, "ready_with_review");
  assert.ok(duplicate.result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 5), "one date cannot close a second role anchor");
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
  const source = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2022 — Present • Research Lead", "Built a planning tool for local teams.", "", "Shipped a separate field program for neighborhood teams.", "", "2018 — 2019 • background tenure note"].join("\n");
  const gapReply = { employers: [{ name: "Contoso Media", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2022", end: "Present", lines: [3, 3] }], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] }], nonJob: [{ lines: [8, 8], reason: "background note" }] };
  const gap = await run(source, [gapReply, gapReply]);
  assert.equal(gap.result.status, "ready_with_review", "a set-aside elsewhere cannot excuse a separate work line");
  assert.ok(gap.result.reconciliation.failures.includes("reconciliation_failed") || gap.result.unread.some((item) => item.kind === "residual" && item.lines[0] === 6));
});
it("T-K7-14 non-job cannot hide unfamiliar or bare dated roles", async () => {
  for (const tail of [" • Solutions Architect", " • Program Coordinator", " • customer success partner", ""]) {
    const source = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • Research Lead", "Built a planning tool for local teams.", `May 2019 — May 2021${tail}`].join("\n");
    const reply = { employers: [{ name: "Contoso Media", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2020", end: "Present", lines: [3, 3] }], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] }], nonJob: [{ lines: [5, 5], reason: "not another role" }] };
    const { result, calls } = await run(source, [reply, reply]);
    assert.equal(calls, 2, `repair read for ${tail || "bare date"}`);
    assert.equal(result.status, "ready_with_review", `dated role stays visible for ${tail || "bare date"}`);
    assert.ok(result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 5), `unread date for ${tail || "bare date"}`);
    assert.ok(result.setAside.some((item) => item.lines[0] === 5 && item.reviewLevel === "role"));
    assert.ok(result.review.claims.some((item) => item.lines[0] === 5 && item.kind === "set_aside"));
  }
  const noteSource = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • Research Lead", "Built a planning tool for local teams.", "2018 — 2019 • background tenure note"].join("\n");
  const noteReply = { employers: [{ name: "Contoso Media", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2020", end: "Present", lines: [3, 3] }], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] }], nonJob: [{ lines: [5, 5], reason: "background note" }] };
  const note = await run(noteSource, [noteReply]);
  assert.equal(note.result.status, "ready", "an explicit background tenure note remains claim-level review");
  assert.equal(note.result.setAside.find((item) => item.lines[0] === 5)?.reviewLevel, "claim");
});
it("T-K7-15 employer dates cannot close a titled date anchor", async () => {
  const source = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • Research Lead", "Built a planning tool for local teams."].join("\n");
  const employer = { name: "Contoso Media", start: "Jan 2020", end: "Present", lines: [2, 2], roles: [], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] };
  const missing = await run(source, [{ employers: [employer] }, { employers: [employer] }]);
  assert.equal(missing.result.status, "ready_with_review");
  assert.ok(missing.result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 3));
  const twoDates = `${source}\nJan 2020 — Present • Sales Manager`;
  const laterRole = { ...employer, roles: [{ title: "Sales Manager", start: "Jan 2020", end: "Present", lines: [5, 5] }] };
  const partial = await run(twoDates, [{ employers: [laterRole] }, { employers: [laterRole] }]);
  assert.equal(partial.result.status, "ready_with_review");
  assert.deepEqual(partial.result.employers[0].roles.map((role) => role.title), ["Sales Manager"]);
  assert.ok(partial.result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 3));
  assert.equal(partial.result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 5), false);
});
it("T-K7-16 a contextual umbrella tenure remains visible review", async () => {
  for (const context of ["Springfield, IL • two progressive roles", "across two progressive roles"]) {
    const source = ["EXPERIENCE", "Contoso Media — contoso.example", `Jan 2020 — Present • ${context}`, "Jan 2020 — Dec 2021 • Research Lead", "Jan 2022 — Present • Program Coordinator"].join("\n");
    const employer = { name: "Contoso Media", start: "Jan 2020", end: "Present", lines: [2, 2], roles: [{ title: "Research Lead", start: "Jan 2020", end: "Dec 2021", lines: [4, 4] }, { title: "Program Coordinator", start: "Jan 2022", end: "Present", lines: [5, 5] }], claims: [] };
    const { result } = await run(source, [{ employers: [employer] }]);
    assert.equal(result.status, "ready", "the umbrella tenure is explicit context, not a missing role");
    assert.ok(result.setAside.some((item) => item.lines[0] === 3 && item.reason === "employer_umbrella_context"));
    assert.ok(result.review.claims.some((item) => item.lines[0] === 3 && item.kind === "set_aside"));
    assert.equal(result.coverage.anchorsAccounted, result.coverage.anchorsTotal, "grounded umbrella context counts as an accounted date");
  }
  const missingSource = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • across two progressive roles"].join("\n");
  const missingReply = { employers: [{ name: "Contoso Media", start: "Jan 2020", end: "Present", lines: [2, 2], roles: [], claims: [] }], nonJob: [{ lines: [3, 3], reason: "not a role" }] };
  const missing = await run(missingSource, [missingReply, missingReply]);
  assert.equal(missing.result.status, "ready_with_review", "context cannot excuse missing roles that the source itself announces");
  assert.ok(missing.result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 3));
});
for (const [id, label, datedLine] of [
  ["T-K7-17", "title before date", "Research Lead  Jan 2020 — Present"],
  ["T-K7-18", "title after date", "Jan 2020 — Present • Research Lead"],
  ["T-K7-19", "title and city before date", "Research Lead, Springfield  Jan 2020 — Present"],
]) it(`${id} employer tenure cannot close ${label}`, async () => {
  const source = ["EXPERIENCE", "Contoso Media — contoso.example", datedLine, "Built a planning tool for local teams."].join("\n");
  const employer = { name: "Contoso Media", start: "Jan 2020", end: "Present", lines: [2, 2], roles: [], claims: [{ text: "Built a planning tool for local teams.", lines: [4, 4] }] };
  const { result, calls } = await run(source, [{ employers: [employer] }, { employers: [employer] }]);
  assert.equal(calls, 2, "the missing role gets a repair read");
  assert.equal(result.status, "ready_with_review");
  assert.ok(result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 3));
});
it("T-K7-20 a titled employer header cannot use tenure to close its role", async () => {
  const source = ["EXPERIENCE", "Fabrikam Labs — fabrikam.example Founder & AI Engineer • Jan 2025 — Present", "Built a planning tool for local teams."].join("\n");
  const employer = { name: "Fabrikam Labs", start: "Jan 2025", end: "Present", lines: [2, 2], roles: [], claims: [{ text: "Built a planning tool for local teams.", lines: [3, 3] }] };
  const { result, calls } = await run(source, [{ employers: [employer] }, { employers: [employer] }]);
  assert.equal(calls, 2);
  assert.equal(result.status, "ready_with_review");
  assert.ok(result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 2));
});
it("T-K7-21 a bare date beneath the header closes with employer tenure", async () => {
  const source = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present"].join("\n");
  const employer = { name: "Contoso Media", start: "Jan 2020", end: "Present", lines: [2, 2], roles: [], claims: [] };
  const { result, calls } = await run(source, [{ employers: [employer] }]);
  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.unread, []);
  const sameLine = ["EXPERIENCE", "Contoso Media (formerly Litware Radio) — contoso.example • Jan 2020 — Present"].join("\n");
  const named = await run(sameLine, [{ employers: [{ ...employer, aliasClause: "(formerly Litware Radio)" }] }]);
  assert.equal(named.result.status, "ready", "the employer's own name, alias, and site leave no role words");
  assert.deepEqual(named.result.unread, []);
});
it("T-K7-22 a grounded dated role closes without a census employer header", async () => {
  const source = ["EXPERIENCE", "Research Lead, Tailspin Studio 2025 — Present"].join("\n");
  const employer = { name: "Tailspin Studio", start: "2025", end: "Present", lines: [2, 2], roles: [{ title: "Research Lead", start: "2025", end: "Present", lines: [2, 2] }], claims: [] };
  const { result, calls } = await run(source, [{ employers: [employer] }]);
  assert.equal(calls, 1);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.unread, []);
  assert.equal(result.employers[0].roles.length, 1);
});
it("T-K7-23 role words cannot be erased by mislabeled employer metadata", async () => {
  const source = ["EXPERIENCE", "Fabrikam Labs — fabrikam.example Founder & AI Engineer • Jan 2025 — Present"].join("\n");
  for (const field of ["aliasClause", "site"]) {
    const employer = { name: "Fabrikam Labs", start: "Jan 2025", end: "Present", lines: [2, 2], roles: [], claims: [], [field]: "Founder & AI Engineer" };
    const { result } = await run(source, [{ employers: [employer] }, { employers: [employer] }]);
    assert.equal(result.status, "ready_with_review", `${field} cannot impersonate the employer's own identity`);
    assert.ok(result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 2));
  }
});
it("T-K7-24 a dated role attributed to another employer cannot close this block", () => {
  const source = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • Research Lead", "Fabrikam Labs — fabrikam.example", "May 2019 — May 2021 • Sales Manager"].join("\n");
  const employers = [{ name: "Contoso Media", lines: [2, 2], roles: [{ title: "Research Lead", start: "2020-01", end: "present", lines: [3, 3] }, { title: "Sales Manager", start: "2019-05", end: "2021-05", lines: [5, 5] }], claims: [] }, { name: "Fabrikam Labs", lines: [4, 4], roles: [], claims: [] }];
  const result = reconcile.reconcileRead({ lsrc: source, census: censusResume(source), employers });
  assert.ok(result.unaccounted.some((item) => item.kind === "date_range" && item.lines[0] === 5));
});
it("T-K7-25 dotted title words are not employer sites", async () => {
  for (const title of ["Node.js", "React.js", "ASP.NET"]) {
    const source = ["EXPERIENCE", `Fabrikam Labs — fabrikam.example ${title} • Jan 2025 — Present`].join("\n");
    const employer = { name: "Fabrikam Labs", start: "Jan 2025", end: "Present", lines: [2, 2], roles: [], claims: [] };
    const { result, calls } = await run(source, [{ employers: [employer] }, { employers: [employer] }]);
    assert.equal(calls, 2, `${title} receives a repair read`);
    assert.equal(result.status, "ready_with_review", `${title} is not a site`);
    assert.ok(result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 2));
  }
  const source = ["EXPERIENCE", "Contoso Media — contoso.example", "Jan 2020 — Present • Node.js"].join("\n");
  const employer = { name: "Contoso Media", site: "Node.js", start: "Jan 2020", end: "Present", lines: [2, 3], roles: [], claims: [] };
  const citedSite = await run(source, [{ employers: [employer] }, { employers: [employer] }]);
  assert.equal(citedSite.result.status, "ready_with_review", "a model site field cannot erase a dotted role title");
  assert.ok(citedSite.result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 3));
});
it("T-K7-26 every title segment on a dated line needs its own role", async () => {
  const source = ["EXPERIENCE", "Research Lead, Sales Manager, Tailspin Studio 2025 — Present"].join("\n");
  const employer = { name: "Tailspin Studio", start: "2025", end: "Present", lines: [2, 2], roles: [{ title: "Research Lead", start: "2025", end: "Present", lines: [2, 2] }], claims: [] };
  const omitted = await run(source, [{ employers: [employer] }, { employers: [employer] }]);
  assert.equal(omitted.calls, 2);
  assert.equal(omitted.result.status, "ready_with_review");
  assert.ok(omitted.result.unread.some((item) => item.kind === "date_range" && item.lines[0] === 2));
  const complete = { ...employer, roles: [...employer.roles, { title: "Sales Manager", start: "2025", end: "Present", lines: [2, 2] }] };
  const both = await run(source, [{ employers: [complete] }]);
  assert.equal(both.result.status, "ready", "both grounded titles account for the one dated line");
  assert.deepEqual(both.result.unread, []);
});
