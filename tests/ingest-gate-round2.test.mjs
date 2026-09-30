import assert from "node:assert/strict";
import { beforeEach, afterEach, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger, ensureLedger, LEDGER_BUILDER_VERSION } from "../server/materials-ledger-build.mjs";
import { readLedger, validateLedger, resolveLedgerPath } from "../server/materials-ledger.mjs";
import { scoreClaims } from "../server/materials-claim-score.mjs";
import { planResume } from "../server/materials-outline.mjs";

const source = "EXPERIENCE\nContoso Media | 2022 — Present\nResearch Lead | 2022 — Present\n• Built a planning tool.\nFabrikam Labs | 2018 — 2021\nAnalyst | 2018 — 2021\n• Analyzed fictional reports.";
const reply = { employers: [
  { name: "Contoso Media", headerLine: 2, roles: [{ title: "Research Lead", line: 3 }], bullets: [{ text: "Built a planning tool.", line: 4 }] },
  { name: "Fabrikam Labs", headerLine: 5, roles: [{ title: "Analyst", line: 6 }], bullets: [{ text: "Analyzed fictional reports.", line: 7 }] },
] };
const pin = { provider: "local", model: "fictional" };
const extract = { nouns: [], outcomes: [] };
const build = (profile, structure) => buildLedger({ profile, resumeText: source, structure });
let home, prior;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ingest-p2-"));
  prior = Object.fromEntries(["HOME", "USERPROFILE", "JOBBORED_PROFILE_PATH"].map((key) => [key, process.env[key]]));
  process.env.HOME = process.env.USERPROFILE = home;
  process.env.JOBBORED_PROFILE_PATH = join(home, ".jobbored", "profile.json");
});
afterEach(async () => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
});
const read = (extra = {}) => ensureLedger({ profile: null, resumeText: source, pin, callStage: async () => structuredClone(reply), ...extra });
const shown = (plan) => [...plan.featured.flatMap((entry) => entry.claimIds), ...plan.earlier];
const outline = (ledger, kept) => planResume({ ledger, kept, featuredMax: 2, perFeaturedMax: 4, earlierMax: 4 });

it("P2-8 profile-only experience without W2 provenance survives with profile source refs", async () => {
  const ledger = await read({ profile: { experiences: [
    { company: "Contoso Media", title: "Obsolete Derived Title" },
    { company: "Tailspin Studio", title: "Catalog Designer", start: "2016", end: "2017" },
  ] } });
  const profileEmployer = ledger.employers.find((entry) => entry.name === "Tailspin Studio");
  assert.ok(profileEmployer, "a profile-only employer must not disappear before W2 migration");
  assert.deepEqual(profileEmployer.sourceRefs, ["profile"]);
  assert.equal(ledger.employers.find((entry) => entry.name === "Contoso Media").roles[0].title, "Research Lead");
  const role = ledger.claims.find((claim) => claim.kind === "role" && claim.employerId === profileEmployer.id);
  assert.ok(role, "profile-only role remains renderable");
  assert.deepEqual(role.sourceRefs, ["profile"]);
  const pool = scoreClaims({ extract, ledger, limit: 20 });
  assert.ok(pool.some((item) => item.claimId === role.id));
  assert.ok(shown(outline(ledger, pool.map((item) => item.claimId))).includes(role.id));
  assert.equal((await readLedger()).ok, true, "profile source flags pass the persisted schema");
});

it("P2-9 layout-rehomed claims retain placement review through persistence, scoring and outline", async () => {
  const displaced = structuredClone(reply);
  displaced.employers[0].bullets.push(displaced.employers[1].bullets.pop());
  const ledger = await read({ callStage: async () => displaced });
  assert.equal(ledger.ingest.status, "ready");
  const claim = ledger.claims.find((entry) => entry.text === "Analyzed fictional reports.");
  assert.ok(claim);
  assert.equal(claim.attribution, "inferred");
  assert.equal(claim.review, "check where this belongs");
  assert.equal(claim.quarantined, undefined);
  const persisted = (await readLedger()).ledger.claims.find((entry) => entry.id === claim.id);
  assert.equal(persisted.attribution, "inferred");
  const pool = scoreClaims({ extract, ledger, limit: 20 });
  assert.ok(pool.some((item) => item.claimId === claim.id));
  assert.ok(shown(outline(ledger, [claim.id])).includes(claim.id));
});

it("P2-9 a claim cited inside another employer section never remains under the wrong employer", async () => {
  const ready = await read();
  const structure = structuredClone(ready.resumeStructure);
  const foreign = structure.employers[1].claims.pop();
  foreign.roleAttribution = "inferred";
  structure.employers[0].claims.push(foreign);
  const ledger = build(null, structure);
  const claims = ledger.claims.filter((claim) => claim.text === "Analyzed fictional reports.");
  assert.equal(claims.length, 1, "the grounded claim stays accounted for");
  assert.equal(claims[0].employerId, "fabrikam-labs", "the wrong employer must not receive the foreign source fact");
  assert.equal(claims[0].review, "check where this belongs");
  assert.ok(!ledger.claims.some((claim) => claim.text === claims[0].text && claim.employerId === "contoso-media"));
  assert.ok(ledger.claims.some((claim) => claim.text === "Built a planning tool."));
  assert.equal(validateLedger(ledger).ok, true);
});

it("P3-11 a changed résumé without a model is stale and preserves the published ledger", async () => {
  await read();
  const before = await readFile(resolveLedgerPath(), "utf8");
  const refused = await read({ resumeText: `${source}\nA new fictional source note.`, pin: null, callStage: undefined });
  assert.equal(refused.ingest.code, "stale_ledger");
  assert.equal(refused.claims.length, 0);
  assert.equal(await readFile(resolveLedgerPath(), "utf8"), before);
});

it("P3-10 role-only employers publish ready without needing a bullet coverage gate", async () => {
  const roleOnly = { employers: reply.employers.map((entry) => ({ ...entry, bullets: [] })) };
  const text = source.split("\n").filter((line) => !line.startsWith("•")).join("\n");
  roleOnly.employers[1].headerLine = 4;
  roleOnly.employers[1].roles[0].line = 5;
  const ledger = await read({ resumeText: text, callStage: async () => roleOnly });
  assert.equal(ledger.ingest.status, "ready");
  assert.equal(ledger.claims.filter((claim) => claim.kind === "role").length, 2);
  assert.equal(ledger.ingest.coverage.employersWithClaims, 2);
  assert.equal(ledger.builderVersion, LEDGER_BUILDER_VERSION);
});
