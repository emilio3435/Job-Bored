import assert from "node:assert/strict";
import { beforeEach, afterEach, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLedger } from "../server/materials-ledger-build.mjs";
import { readLedger, writeLedgerAtomic } from "../server/materials-ledger.mjs";
import { scoreClaims } from "../server/materials-claim-score.mjs";
import { planResume } from "../server/materials-outline.mjs";

// Astra's primary read covers this claim before repair discovers Fabrikam.
const text = ["EXPERIENCE", "Contoso Media", "Analyst | 2022 — Present",
  "• Built a fictional planning tool.", "Fabrikam Labs", "Research Lead | 2018 — 2021",
  "• Documented fictional results.", "• Validated local inputs.",
  "• Reviewed weekly summaries.", "• Planned regional workshops.", "SKILLS"].join("\n");
const primary = { employers: [{ name: "Contoso Media", headerLine: 2,
  roles: [{ title: "Analyst", line: 3 }],
  bullets: [{ text: "Built a fictional planning tool.", line: 4 }, { text: "Documented fictional results.", line: 7 }],
}] };
const repair = { employers: [{ name: "Fabrikam Labs", headerLine: 5,
  roles: [{ title: "Research Lead", line: 6 }],
  bullets: ["Validated local inputs.", "Reviewed weekly summaries.", "Planned regional workshops."].map((value, index) => ({ text: value, line: index + 8 })),
}] };
const pin = { provider: "local", model: "fictional" };
let home, prior;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ingest-r3-"));
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
async function read(extra = {}) {
  let calls = 0;
  return ensureLedger({ profile: null, resumeText: text, pin,
    callStage: async () => structuredClone(calls++ === 0 ? primary : repair), ...extra });
}
const storedResult = async (ledger) => JSON.parse(await readFile(ledger.ingest.resultPath, "utf8"));

it("R3-1 repair-added employer retains the primary claim with check_role through the draft pool", async () => {
  const ledger = await read();
  const result = await storedResult(ledger);
  assert.equal(result.reads, 2, "the real reader must execute its primary and repair paths");
  assert.equal(result.status, "ready");
  assert.deepEqual(result.couldntPlace, []);
  assert.deepEqual(result.missingEmployers, []);
  const matches = ledger.claims.filter((claim) => claim.text === "Documented fictional results.");
  assert.equal(matches.length, 1, "a covered claim must not vanish or duplicate after repair adds its real employer");
  const claim = matches[0];
  assert.equal(claim.employerId, "fabrikam-labs");
  assert.equal(claim.roleId, "fabrikam-labs-r1", "the repaired employer's role replaces the primary role binding");
  assert.equal(claim.attribution, "inferred");
  assert.equal(claim.review, "check where this belongs");
  const reviews = result.review.claims.filter((item) => item.kind === "check_role" && item.lines[0] === 7);
  assert.equal(reviews.length, 1, "the persisted result must account for the reassignment and feed the draft notice");
  const oldEmployer = result.structure.employers.find((entry) => entry.name === "Contoso Media");
  const actualEmployer = result.structure.employers.find((entry) => entry.name === "Fabrikam Labs");
  assert.ok(!oldEmployer.claims.some((entry) => entry.text === claim.text));
  assert.ok(actualEmployer.claims.some((entry) => entry.text === claim.text));
  assert.equal((await readLedger()).ledger.claims.find((entry) => entry.id === claim.id).employerId, claim.employerId);
  const pool = scoreClaims({ extract: { nouns: [], outcomes: [] }, ledger, limit: 20 });
  assert.ok(pool.some((entry) => entry.claimId === claim.id));
  const outline = planResume({ ledger, kept: [claim.id], featuredMax: 2, perFeaturedMax: 4, earlierMax: 4 });
  assert.ok([...outline.featured.flatMap((entry) => entry.claimIds), ...outline.earlier].includes(claim.id));

  const again = await read({ profile: { strengths: [{ name: "Planning", evidence: "Built a fictional review process." }] },
    callStage: async () => { throw new Error("profile overlay must not re-read the source"); } });
  assert.equal(again.claims.filter((entry) => entry.text === claim.text).length, 1);
  assert.equal((await storedResult(again)).review.claims.filter((entry) => entry.kind === "check_role" && entry.lines[0] === 7).length, 1);
});

it("R3-1 older builder output cannot cache the silently lost claim", async () => {
  await read();
  const old = structuredClone((await readLedger()).ledger);
  old.builderVersion = 12;
  old.claims = old.claims.filter((claim) => claim.text !== "Documented fictional results.");
  await writeLedgerAtomic(old);
  const rebuilt = await read();
  assert.equal(rebuilt.rebuilt, true);
  assert.equal(rebuilt.claims.filter((claim) => claim.text === "Documented fictional results.").length, 1);
});
