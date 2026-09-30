import assert from "node:assert/strict";
import { it } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scriptedMrevFetch } from "./materials-mrev-stub.test.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const moduleUrl = new URL("../scripts/ingest-live-probe.mjs", import.meta.url);
const repo = dirname(dirname(fileURLToPath(moduleUrl)));
it("T-LIVE-01 the probe isolates five fresh reads, scores exact keys, and keeps names out of stdout", async () => {
  assert.ok(existsSync(moduleUrl), "the safe live probe must exist");
  const { runIngestLiveProbe, runProbeWorker } = await import(moduleUrl);
  const base = await mkdtemp(join(tmpdir(), "ingest-probe-"));
  const scratch = join(base, "source-home");
  const source = "Contoso — Analyst, 2018–2026\n- Built 5 regional reporting tools.\nNorthwind Trading — Lead, 2015–2018\n- Trained 8 operators to review data.";
  await mkdir(join(scratch, ".jobbored"), { recursive: true });
  await writeFile(join(scratch, ".jobbored", "resume.txt"), source);
  await writeFile(join(scratch, ".jobbored", "claim-ledger.json"), "original ledger\n");
  await writeFile(join(scratch, ".jobbored", "ingest-result.json"), "original result\n");
  const keys = join(base, "keys.json"), job = join(base, "job.json"), out = join(base, "evidence");
  await writeFile(keys, JSON.stringify(["contoso", "northwind trading"]));
  await writeFile(job, JSON.stringify({ slug: "fictional-role", company: "Fabrikam", title: "Analyst", feature: "resume", notes: "", jobUrl: "https://example.com/job", jobDescription: "Fabrikam seeks an analytics lead who builds reliable reporting pipelines, trains regional operators, and owns weekly dashboards. Requirements include SQL, Python, stakeholder communication, five years of experience, and clear documentation. Responsibilities include improving handoffs, measuring delivery performance, and leading data quality reviews across regional teams. The team works remotely and offers a learning budget. You will partner with engineering and customer operations to prioritize improvements, explain tradeoffs, and maintain reliable documentation. Compensation includes salary, health coverage, and professional development support." }));
  const env = { HOME: base, INGEST_SCRATCH_HOME: scratch, INGEST_PINNED_KEYS: keys, INGEST_JOB: job, INGEST_OUT: out };
  const prior = Object.fromEntries(["HOME", "USERPROFILE", "JOBBORED_PROFILE_PATH", "JOBBORED_LLM_CONFIG_PATH", "JOBBORED_APPLICATIONS_ROOT", "INGEST_PROBE_WORKER", "INGEST_WORKER_OUT", "INGEST_JOB"].map((key) => [key, process.env[key]]));
  const output = [];
  let reads = 0, drafts = 0;
  try {
    const runWorker = async ({ mode, home, outputPath, jobPath }) => {
      process.env.HOME = process.env.USERPROFILE = home;
      process.env.INGEST_PROBE_WORKER = mode;
      process.env.INGEST_WORKER_OUT = outputPath;
      process.env.INGEST_JOB = jobPath;
      if (mode === "read") {
        reads += 1;
        assert.equal(existsSync(join(home, ".jobbored", "claim-ledger.json")), false);
        assert.equal(existsSync(join(home, ".jobbored", "ingest-result.json")), false);
      } else drafts += 1;
      await runProbeWorker({ pin: { provider: "local", model: "fictional", resolvedModel: "fictional", baseUrl: "http://127.0.0.1:9/v1" },
        fetchImpl: scriptedMrevFetch().fetchImpl, openSession: null,
        structureCallStage: async () => ({ employers: [
          { name: "Contoso", headerLine: 1, roles: [{ title: "Analyst", line: 1, start: "2018", end: "2026" }], bullets: [{ text: "Built 5 regional reporting tools.", line: 2 }] },
          { name: "Northwind Trading", headerLine: 3, roles: [{ title: "Lead", line: 3, start: "2015", end: "2018" }], bullets: [{ text: "Trained 8 operators to review data.", line: 4 }] },
        ] }),
      });
    };
    const result = await runIngestLiveProbe(env, { runWorker, stdout: (line) => output.push(line) });
    assert.equal(reads, 5);
    assert.equal(drafts, 1);
    assert.equal(result.passed, 5);
    assert.equal(result.runs.length, 5);
    assert.equal(result.draft.ok, true, "the real package step must publish the offline draft");
    assert.deepEqual(new Set(result.draft.fittedEmployers), new Set(["Contoso", "Northwind Trading"]));
    assert.ok(existsSync(join(result.draft.packageDir, "render-model.json")));
    assert.ok(result.runs.every((run) => run.keys.every((key) => key.present)));
    assert.doesNotMatch(output.join("\n"), /Contoso|Northwind|Fabrikam|Analyst|regional/i);
    assert.match(output.join("\n"), /E1.*PASS.*[a-f0-9]{8}/);
    assert.equal(await readFile(join(scratch, ".jobbored", "claim-ledger.json"), "utf8"), "original ledger\n");
    assert.equal(await readFile(join(scratch, ".jobbored", "ingest-result.json"), "utf8"), "original result\n");
    assert.equal((await readdir(out)).filter((name) => /^read-/.test(name)).length, 5);
    const evidence = JSON.parse(await readFile(join(out, "read-1", "worker-result.json"), "utf8"));
    assert.equal(evidence.ledger.employers[0].name, "Contoso");
    for (const invalid of [
      { HOME: userInfo().homedir }, { HOME: join(userInfo().homedir, ".jobbored") },
      { INGEST_SCRATCH_HOME: userInfo().homedir }, { INGEST_SCRATCH_HOME: join(userInfo().homedir, ".jobbored") },
      { INGEST_PINNED_KEYS: join(repo, "keys.json") }, { INGEST_OUT: join(repo, "probe-evidence") },
      { INGEST_OUT: scratch }, { INGEST_RUNS: "0" }, { INGEST_RUNS: "5junk" },
    ]) await assert.rejects(runIngestLiveProbe({ ...env, ...invalid }, { runWorker }), /unsafe|refus|outside|positive|runs/i);
    await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(moduleUrl)], {
      env: { ...process.env, ...env, HOME: userInfo().homedir, INGEST_PROBE_WORKER: "" },
    }), (error) => error.code === 1 && error.stdout === "" && !/Contoso|Northwind/i.test(error.stderr));
    const linked = join(base, "linked-repo");
    await symlink(repo, linked);
    await assert.rejects(runIngestLiveProbe({ ...env, INGEST_OUT: join(linked, "evidence") }, { runWorker }), /outside|unsafe|refus/i);
    await writeFile(keys, JSON.stringify(["contoso", "tailspin studio"]));
    const miss = await runIngestLiveProbe({ ...env, INGEST_RUNS: "1", INGEST_OUT: join(base, "missing-evidence") }, { runWorker, stdout: () => {} });
    assert.equal(miss.passed, 0, "two present employers cannot substitute for a missing pinned key");
    assert.equal(miss.runs[0].keys[1].present, false);
  } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(base, { recursive: true, force: true });
  }
});
