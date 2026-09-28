/**
 * Materials Wave 2 on the drafter side:
 *   U-4  pending.json carries structured stages and plain-word messages;
 *        no raw "stage: status" string ever reaches progress.message.
 *   U-5  "Draft both" (feature resume + then cover_letter) runs the resume,
 *        then queues the letter as its own run with its own verdict.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialsDrafter, stageProgressMessage } from "../server/materials-drafter.mjs";
import { normalizeRequestBody } from "../server/materials-request.mjs";
import { scriptedMrevFetch as scriptedPipelineFetch } from "./materials-mrev-stub.test.mjs";

const USER_RESUME = {
  source: "upload",
  filename: "resume.txt",
  addedAt: "2026-09-26T00:00:00.000Z",
  text: [
    "Jordan Rivera",
    "Austin, TX · jordan.rivera@example.com · 555-010-2030",
    "Northwind — Digital Sales Manager, 2021–2026",
    "- Grew Austin to a top-4 national ranking on a $12M+ book with Google Ads.",
    "- Drove 125% YoY paid-search conversion growth on a flagship account.",
    "Example App — Founder, 2024–present",
    "- Shipped an SEM forecast tool that ran 24+ forecasts against $3.1M of pipeline.",
    "- Built streaming ingestion for analytics events with Kafka and Postgres.",
  ].join("\n"),
};

const JD_TEXT = [
  "Data Platform Engineer at Acme Analytics in Austin, TX. This role builds warehouse",
  "pipelines and streaming ingestion for analytics events, owns observability dashboards,",
  "and partners with analysts on pipeline math and spend reporting.",
  "Requirements: five years with warehouse modeling, streaming ingestion, Python, SQL,",
  "orchestration with Airflow, observability, and cloud platforms. You have shipped",
  "production data systems with clear reliability practices and documentation. The",
  "team values operators who read the source, trace failures to their root cause,",
  "and write plain-language runbooks so on-call rotations stay calm during incidents.",
].join("\n");

const pin = { provider: "local", model: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };

function deps(dir, extra = {}) {
  const stub = scriptedPipelineFetch(extra.stub || {});
  return {
    applicationsRoot: dir,
    loadPin: () => pin,
    resolvePin: async (loaded) => ({ ...loaded, resolvedModel: "stub" }),
    scrapeJob: async () => ({ description: JD_TEXT }),
    fetchImpl: stub.fetchImpl,
    openSession: null,
    logoLoader: async () => [],
    targetLogoLoader: async () => null,
    employerLogoLoader: async () => [],
    readSavedResume: async () => null,
  };
}

function request(overrides = {}) {
  return {
    resume: USER_RESUME,
    slug: "acme-data-platform-engineer",
    company: "Acme Analytics",
    title: "Data Platform Engineer",
    feature: "resume",
    jobUrl: "https://example.com/job",
    notes: "",
    ...overrides,
  };
}

describe("materials W2 · drafter", () => {
  let dir;
  let prior;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-w2-drafter-"));
    prior = { home: process.env.HOME, profile: process.env.JOBBORED_PROFILE_PATH, jb: process.env.JOBBORED_HOME };
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.JOBBORED_HOME = join(dir, ".jobbored");
    process.env.JOBBORED_PROFILE_PATH = join(dir, ".jobbored", "profile.json");
  });
  afterEach(async () => {
    process.env.HOME = prior.home;
    process.env.USERPROFILE = prior.home;
    for (const [key, value] of [["JOBBORED_PROFILE_PATH", prior.profile], ["JOBBORED_HOME", prior.jb]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("should never put a raw stage id in the progress message", () => {
    for (const stage of ["prepare", "write", "validate", "render", "judge", "save", "repair", "unknown.stage"]) {
      const msg = stageProgressMessage(stage, "resume");
      assert.doesNotMatch(msg, /[a-z]+\.[a-z]+|: (ok|review|failed|running)/, `${stage} → ${msg}`);
      assert.match(msg, /…$/);
    }
    assert.equal(stageProgressMessage("write", "cover_letter"), "Checking the facts…");
  });

  it("should record structured stages in pending.json while drafting", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    /* Hold the judge call so pending.json is read mid-run. */
    const drafter = createMaterialsDrafter(deps(dir, { stub: { gate, gateAt: 4 } }));
    await drafter.enqueue(request());
    const pendingPath = join(dir, "acme-data-platform-engineer", "pending.json");
    let pending = null;
    for (let i = 0; i < 200; i += 1) {
      pending = JSON.parse(await readFile(pendingPath, "utf8"));
      if (pending.progress.stages && pending.progress.stages.some((s) => s.stage === "render")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    release();
    await drafter.runUntilIdle();
    assert.equal(pending.progress.phase, "drafting");
    const ids = pending.progress.stages.map((s) => s.stage);
    assert.deepEqual(ids.slice(0, 4), ["prepare", "write", "validate", "render"]);
    for (const s of pending.progress.stages) assert.match(s.status, /^(ok|review|failed|skipped)$/);
    assert.doesNotMatch(pending.progress.message, /\(|claims\.|jd\.|: running/);
    await assert.rejects(readFile(pendingPath), "pending.json comes down after the run");
  });

  it("should accept then=cover_letter only on a resume request", () => {
    assert.equal(normalizeRequestBody({ ...request(), then: "cover_letter" }).then, "cover_letter");
    assert.equal(normalizeRequestBody({ ...request(), feature: "cover_letter", then: "cover_letter" }).then, undefined);
    assert.equal(normalizeRequestBody({ ...request(), then: "resume" }).then, undefined);
  });

  it("should run the resume, then the letter as its own run with its own verdict (Draft both)", async () => {
    const drafter = createMaterialsDrafter(deps(dir));
    await drafter.enqueue({ ...request(), then: "cover_letter" });
    const first = JSON.parse(await readFile(join(dir, "acme-data-platform-engineer", "pending.json"), "utf8"));
    assert.equal(first.feature, "resume");
    assert.equal(first.next, "cover_letter");
    await drafter.runUntilIdle();
    const appDir = join(dir, "acme-data-platform-engineer");
    const runs = (await readdir(join(appDir, "runs"))).sort();
    assert.equal(runs.length, 2, `two runs, got ${runs.join(", ")}`);
    const resumeQa = JSON.parse(await readFile(join(appDir, "qa.resume.json"), "utf8"));
    const letterQa = JSON.parse(await readFile(join(appDir, "qa.letter.json"), "utf8"));
    assert.notEqual(resumeQa.runId, letterQa.runId, "each document carries its own run's verdict");
    assert.match(resumeQa.disposition, /^(READY|REVIEW|FAIL)$/);
    assert.match(letterQa.disposition, /^(READY|REVIEW|FAIL)$/);
    const runFeatures = await Promise.all(runs.map(async (id) => JSON.parse(await readFile(join(appDir, "runs", id, "run.json"), "utf8")).feature));
    assert.deepEqual(runFeatures.sort(), ["cover_letter", "resume"]);
    await assert.rejects(readFile(join(appDir, "pending.json")));
  });

  it("should not queue the letter when the resume run fails", async () => {
    const drafter = createMaterialsDrafter(deps(dir));
    await drafter.enqueue({
      ...request({ resume: { ...USER_RESUME, text: "Jordan Rivera\nNo experience listed." } }),
      then: "cover_letter",
    });
    await drafter.runUntilIdle();
    const pending = JSON.parse(await readFile(join(dir, "acme-data-platform-engineer", "pending.json"), "utf8"));
    assert.equal(pending.feature, "resume");
    assert.equal(pending.progress.phase, "failed");
  });
});

describe("materials W2 · Wave 3 extras through Draft both", () => {
  it("should hand extras to the chained letter, never to the resume run", () => {
    const base = {
      slug: "acme-role", company: "Acme", title: "PM", jobUrl: "", notes: "",
      resume: { source: "upload", filename: "r.txt", addedAt: "2026-09-26T00:00:00.000Z", text: "Jordan Rivera\nPM" },
    };
    const both = normalizeRequestBody({ ...base, feature: "resume", then: "cover_letter", extras: ["outreach"] });
    assert.deepEqual(both.thenExtras, ["outreach"]);
    assert.equal(both.extras, undefined);
    assert.deepEqual(normalizeRequestBody({ ...base, feature: "resume", then: "cover_letter", outreach: true }).thenExtras, ["outreach"]);
    assert.equal(normalizeRequestBody({ ...base, feature: "resume", then: "cover_letter" }).thenExtras, undefined);
    assert.equal(normalizeRequestBody({ ...base, feature: "resume", extras: ["outreach"] }).thenExtras, undefined);
  });
});
