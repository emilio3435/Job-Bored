import assert from "node:assert/strict";
import { beforeEach, afterEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { ensureLedger, buildLedger } from "../server/materials-ledger-build.mjs";
import { writeLedgerAtomic } from "../server/materials-ledger.mjs";
import { buildManifest } from "../server/application-materials.mjs";

const names = ["Contoso", "Northwind Trading", "Tailspin Studio", "Fabrikam"];
const text = names.flatMap((name, i) => [
  `${name} — Analyst, ${2010 + i * 3}–${2013 + i * 3}`,
  `- Delivered ${i + 2} reporting tools for regional teams.`,
  `- Trained ${i + 4} operators to use weekly dashboards.`,
  `- Reduced missed handoffs by ${i + 10} percent.`,
]).join("\n");
const reply = { employers: names.map((name, i) => ({ name, headerLine: i * 4 + 1,
  roles: [{ title: "Analyst", line: i * 4 + 1, start: String(2010 + i * 3), end: String(2013 + i * 3) }],
  bullets: [2, 3, 4].map((offset) => ({ text: text.split("\n")[i * 4 + offset - 1].slice(2), line: i * 4 + offset })),
})) };
const jd = "Fabrikam seeks an analytics lead who builds reliable reporting pipelines, trains regional operators, and owns weekly dashboards. Requirements include SQL, Python, stakeholder communication, five years of experience, and clear documentation. Responsibilities include improving handoffs, measuring delivery performance, and leading data quality reviews across regional teams. The team works remotely and offers a learning budget. You will partner with engineering and customer operations to prioritize improvements, explain tradeoffs, and maintain reliable documentation. Compensation includes salary, health coverage, and professional development support.";
const pin = { provider: "local", model: "fictional", resolvedModel: "fictional", baseUrl: "http://127.0.0.1:9/v1" };
const hash = (value) => createHash("sha256").update(value).digest("hex");

describe("INGEST drafting gate", () => {
  let home, prior;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "ingest-gate-"));
    prior = Object.fromEntries(["HOME", "USERPROFILE", "JOBBORED_PROFILE_PATH"].map((key) => [key, process.env[key]]));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.JOBBORED_PROFILE_PATH = join(home, ".jobbored", "profile.json");
  });
  afterEach(async () => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  });
  async function run(extra = {}, resumeText = text) {
    let calls = 0;
    const root = join(home, "applications");
    const drafter = createMaterialsDrafter({ applicationsRoot: root,
      loadPin: () => pin, resolvePin: async (value) => value,
      structureCallStage: async () => structuredClone(reply),
      readSavedResume: async () => null,
      openSession: null, intel: false,
      fetchImpl: async () => { throw new Error("No live provider calls"); },
      pipeline: async ({ dir, runId, ledger }) => {
        calls += 1;
        assert.ok(ledger.claims.length);
        const runDir = join(dir, "runs", runId);
        await mkdir(runDir, { recursive: true });
        for (const path of [dir, runDir]) {
          await writeFile(join(path, "manifest.json"), JSON.stringify({ runId, existing: "preserved" }));
          await writeFile(join(path, "run.json"), JSON.stringify({ runId }));
        }
        return { outcome: "published", runId, adopted: true };
      }, ...extra,
    });
    let snapshotBefore = null;
    try { snapshotBefore = await readFile(join(root, "fictional-role", "resume-source.json"), "utf8"); } catch { /* no earlier draft */ }
    await drafter.enqueue({ slug: "fictional-role", company: "Fabrikam", title: "Analytics Lead", feature: "resume", notes: "", jobUrl: "https://example.com/job", jobDescription: jd,
      resume: { source: "upload", filename: "fictional.txt", addedAt: "2026-09-29T00:00:00Z", text: resumeText } });
    await drafter.runUntilIdle();
    const dir = join(root, "fictional-role");
    let pending = null;
    try { pending = JSON.parse(await readFile(join(dir, "pending.json"), "utf8")); } catch { /* successful draft */ }
    return { dir, pending, calls, snapshotBefore };
  }
  async function ledgerWithResult(mutator) {
    const ledger = await ensureLedger({ profile: null, resumeText: text, pin, callStage: async () => structuredClone(reply) });
    const result = JSON.parse(await readFile(ledger.ingest.resultPath, "utf8"));
    mutator(ledger, result);
    await writeFile(ledger.ingest.resultPath, JSON.stringify(result));
    return ledger;
  }
  async function refused(extra, expectedCode) {
    const out = await run(extra);
    assert.equal(out.calls, 0, "refused source must never reach the outline/pipeline");
    assert.equal(out.pending?.progress.phase, "failed");
    assert.equal(out.pending?.progress.code, expectedCode);
    if (out.snapshotBefore === null) await assert.rejects(readFile(join(out.dir, "resume-source.json")), { code: "ENOENT" });
    else assert.equal(await readFile(join(out.dir, "resume-source.json"), "utf8"), out.snapshotBefore);
    return out.pending;
  }

  it("T-K19-02 (guard) a complete ready ledger drafts", async () => {
    const out = await run();
    assert.equal(out.calls, 1);
    assert.equal(out.pending, null);
  });
  for (const [status, code] of [["ready_with_review", "ingest_incomplete"], ["failed", "ingest_failed"], ["needs_model", "ingest_needs_model"], ["partial", "stale_ledger"]]) {
    it(`T-K19-03 ${status} refuses with ${code}`, async () => {
      const ledger = await ledgerWithResult((ledger, result) => { ledger.ingest.status = result.status = status; });
      await refused({ ensureLedger: async () => ledger }, code);
    });
  }
  it("T-K19-03 bullet_lines_set_aside refuses even if the summary says ready", async () => {
    const ledger = await ledgerWithResult((_, result) => { result.notes.push({ kind: "read", reason: "bullet_lines_set_aside", employer: "Contoso", lostLines: 2, sectionLines: 3 }); });
    const pending = await refused({ ensureLedger: async () => ledger }, "ingest_incomplete");
    assert.match(pending.progress.message, /Contoso/);
  });
  it("T-K19-04 full canonical text refuses a prefix-only hash and never slices the selected source", async () => {
    const longText = `${text}\n${"Skills: SQL Python reporting\n".repeat(2500)}Tailspin Studio tail marker`;
    const ledger = await ledgerWithResult((ledger, result) => {
      ledger.ingest.sourceHash = `sha256:${hash(longText.slice(0, 60000))}`;
      ledger.ingest.textSha256 = result.textSha256 = hash(longText.slice(0, 60000));
      ledger.sources.find((source) => source.kind === "resume").hash = ledger.ingest.sourceHash;
    });
    let observed;
    const out = await run({ ensureLedger: async ({ resumeText }) => { observed = resumeText; return ledger; } }, longText);
    assert.equal(out.calls, 0);
    assert.equal(observed, longText);
    assert.equal(out.pending?.progress.code, "stale_ledger");
  });
  it("T-K19-04 a saved canonical tail beyond 60000 characters reaches the length refusal", async () => {
    const saved = `${text}\n${"Skills: SQL Python reporting\n".repeat(2500)}Tailspin Studio tail marker`;
    await mkdir(join(home, ".jobbored"), { recursive: true });
    await writeFile(join(home, ".jobbored", "resume.txt"), saved);
    const out = await run({ readSavedResume: undefined });
    assert.equal(out.calls, 0);
    assert.equal(out.pending?.progress.code, "resume_too_long");
  });
  for (const id of ["T-K19-05", "T-K19-07", "T-K16-03"]) {
    it(`${id} missing employers survive into the refusal payload and visible message`, async () => {
      const missingEmployers = [
        { aliasKey: "northwind trading", displayName: "Northwind Trading", lines: [5, 5] },
        { aliasKey: "tailspin studio", displayName: "Tailspin Studio", lines: [9, 9] },
      ];
      const ledger = await ledgerWithResult((ledger, result) => {
        ledger.ingest.missingEmployers = result.missingEmployers = missingEmployers;
        result.employers = result.employers.filter((entry) => ["Contoso", "Fabrikam"].includes(entry.name));
      });
      const pending = await refused({ ensureLedger: async () => ledger }, "ingest_incomplete");
      assert.deepEqual(pending.missingEmployers, missingEmployers);
      assert.match(pending.progress.message, /2 of 4 employers/);
      for (const name of ["Northwind Trading", "Tailspin Studio"]) assert.ok(pending.progress.message.includes(name));
    });
  }
  for (const id of ["T-K19-06", "T-K16-01"]) {
    it(`${id} a profile-only failed first read requires a model`, async () => {
      const ledger = { employers: [], claims: [{ id: "profile-strength" }], sources: [{ kind: "profile" }], ingest: { status: "failed", code: "ingest_needs_model" }, note: "ingest:failed" };
      const pending = await refused({ ensureLedger: async () => ledger, loadPin: () => null }, "ingest_needs_model");
      assert.match(pending.progress.message, /Connect an AI provider/);
    });
  }
  it("T-K19-06 a legacy profile-only ready ledger still requires a résumé model read", async () => {
    const ledger = { sources: [{ kind: "profile" }], claims: [{ id: "profile-strength" }], employers: [], note: "profile:only", ingest: { status: "ready" } };
    await refused({ ensureLedger: async () => ledger }, "ingest_needs_model");
  });
  it("T-K19-03 missing or corrupt read evidence cannot authorize drafting", async () => {
    const ledger = await ledgerWithResult(() => {});
    await writeFile(ledger.ingest.resultPath, "not JSON");
    await refused({ ensureLedger: async () => ledger }, "ingest_failed");
  });
  it("T-K19-03 the persisted needs_model status cannot be hidden by a ready summary", async () => {
    const ledger = await ledgerWithResult((_, result) => { result.status = "needs_model"; });
    await refused({ ensureLedger: async () => ledger }, "ingest_needs_model");
  });
  it("T-K16-04 ingest_failed names the provider without exposing its raw error", async () => {
    const pending = await refused({ structureCallStage: async () => { throw new Error("fictional private transport diagnostic"); } }, "ingest_failed");
    assert.match(pending.progress.message, /local/i);
    assert.doesNotMatch(pending.progress.message, /private transport diagnostic/);
  });
  it("T-K16-02 a stale stored ledger without a model cannot reach an outline", async () => {
    await writeLedgerAtomic(buildLedger({ profile: { strengths: [{ name: "Reporting", evidence: "Led 8 reporting improvements." }] }, resumeText: text, structure: { source: "model", employers: [], education: [], credentials: [], looseClaims: [] } }));
    await refused({ loadPin: () => null }, "stale_ledger");
  });
  it("T-K10-06 stale ledger with a model ingests inline and drafts only a newly complete read", async () => {
    await writeLedgerAtomic(buildLedger({ profile: { strengths: [{ name: "Reporting", evidence: "Led 8 reporting improvements." }] }, resumeText: text, structure: { source: "model", employers: [], education: [], credentials: [], looseClaims: [] } }));
    let reads = 0;
    const out = await run({ structureCallStage: async () => { reads += 1; return structuredClone(reply); } });
    assert.equal(reads, 1);
    assert.equal(out.calls, 1);
    await refused({ structureCallStage: async () => { throw new Error("fictional model failure"); },
      // Force a real re-read of a different source through ensureLedger.
      ensureLedger: (args) => ensureLedger({ ...args, resumeText: `${text}\n- New reporting work.` }),
    }, "ingest_failed");
  });
  it("T-K19-09 ready set-aside lines and check_role claims carry counts and a non-blocking notice into both manifests", async () => {
    const ledger = await ledgerWithResult((_, result) => {
      result.couldntPlace = [{ id: "aside", kind: "bullet", lines: [4, 4], excerpt: "Never copy claim text into the notice", reason: "uncovered" }];
      result.review.claims = [{ id: "review", kind: "check_role", lines: [6, 6], reason: "role_span_missing" }];
    });
    const out = await run({ ensureLedger: async () => ledger });
    assert.equal(out.calls, 1);
    assert.equal(out.pending, null);
    const manifest = JSON.parse(await readFile(join(out.dir, "manifest.json"), "utf8"));
    const runManifest = JSON.parse(await readFile(join(out.dir, "runs", manifest.runId, "manifest.json"), "utf8"));
    assert.equal(manifest.existing, "preserved");
    assert.deepEqual(manifest.ingestReview.countsByKind, { couldntPlace: 1, check_role: 1 });
    assert.equal(manifest.ingestReview.count, 2);
    assert.deepEqual(manifest.ingestReview.employers, ["Contoso", "Northwind Trading"]);
    assert.match(manifest.ingestReview.notice, /2.*Contoso.*Northwind Trading.*Settings/);
    assert.doesNotMatch(manifest.ingestReview.notice, /Never copy/);
    assert.deepEqual(runManifest.ingestReview, manifest.ingestReview);
    const publicManifest = await buildManifest("fictional-role", { root: join(home, "applications") });
    assert.equal(publicManifest.ingestReview?.notice, manifest.ingestReview.notice,
      "P2-7 the finished-draft payload consumed by role-materials carries the notice");
  });
  it("T-K19-09 (guard) no set-aside items means no notice", async () => {
    const out = await run();
    const manifest = JSON.parse(await readFile(join(out.dir, "manifest.json"), "utf8"));
    assert.ok(!manifest.ingestReview?.notice);
  });
});
