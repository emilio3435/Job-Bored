import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { scriptedPipelineFetch } from "./fixtures/materials-pipeline-stub.mjs";

/* C11: every draft carries the user's resume; Jordan Rivera stands in. */
const USER_RESUME_TEXT = [
  "Jordan Rivera",
  "Austin, TX · jordan.rivera@example.com · 555-010-2030",
  "Northwind — Digital Sales Manager, 2021–2026",
  "- Grew Austin to a top-3 national ranking on a $10M+ book with Google Ads.",
  "- Drove 130% YoY paid-search conversion growth on a flagship account.",
  "Example App — Founder, 2024–present",
  "- Shipped an SEM forecast tool on Gemini that ran 21+ forecasts against $2.4M of pipeline.",
  "- Built streaming ingestion for analytics events with Kafka and Postgres.",
].join("\n");

const USER_RESUME = {
  source: "upload",
  filename: "resume.txt",
  addedAt: "2026-09-26T00:00:00.000Z",
  text: USER_RESUME_TEXT,
};

const pin = {
  provider: "local",
  model: "stub",
  apiKey: "",
  baseUrl: "http://127.0.0.1:9/v1",
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
  "Compensation includes base salary, equity, and an annual learning stipend.",
].join("\n");

function baseDeps(dir, extra = {}) {
  const stub = scriptedPipelineFetch();
  return {
    applicationsRoot: dir,
    loadPin: () => pin,
    resolvePin: async (loaded) => ({ ...loaded, resolvedModel: "stub" }),
    scrapeJob: async () => ({ description: JD_TEXT }),
    fetchImpl: stub.fetchImpl,
    openSession: null,
    logoLoader: async () => [],
    ...extra,
  };
}

function request(overrides = {}) {
  return {
    resume: USER_RESUME,
    slug: "eab-role",
    company: "EAB",
    title: "Director",
    feature: "both",
    jobUrl: "https://example.com/job",
    notes: "",
    ...overrides,
  };
}

describe("createMaterialsDrafter", () => {
  let dir;
  let priorHome;
  let priorProfile;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-draft-"));
    priorHome = process.env.HOME;
    priorProfile = process.env.JOBBORED_PROFILE_PATH;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.JOBBORED_PROFILE_PATH = join(dir, "profile.json");
  });
  afterEach(async () => {
    process.env.HOME = priorHome;
    process.env.USERPROFILE = priorHome;
    if (priorProfile === undefined) delete process.env.JOBBORED_PROFILE_PATH;
    else process.env.JOBBORED_PROFILE_PATH = priorProfile;
    await rm(dir, { recursive: true, force: true });
  });

  it("publishes a degraded REVIEW package without a pin instead of 409", async () => {
    const drafter = createMaterialsDrafter({
      ...baseDeps(dir),
      loadPin: () => null,
      fetchImpl: async () => {
        throw new Error("must not call");
      },
    });
    const result = await drafter.enqueue(request());
    assert.equal(result.ok, true);
    await drafter.runUntilIdle();
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /^Status:\s*REVIEW/im);
    assert.match(report, /llm_unconfigured/);
    await readFile(join(dir, "eab-role", "resume.html"), "utf8");
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
  });

  it("fails ledger_empty when the resume carries no facts", async () => {
    const drafter = createMaterialsDrafter(baseDeps(dir));
    await drafter.enqueue(request({
      resume: { ...USER_RESUME, text: "Jordan Rivera\nNo experience listed." },
    }));
    await drafter.runUntilIdle();
    const pending = JSON.parse(await readFile(join(dir, "eab-role", "pending.json"), "utf8"));
    assert.equal(pending.progress.phase, "failed");
    assert.equal(pending.progress.code, "ledger_empty");
  });

  it("writes REVIEW with jd_unusable when scrape fails on a blurb", async () => {
    const drafter = createMaterialsDrafter({
      ...baseDeps(dir),
      scrapeJob: async () => {
        throw new Error("nope");
      },
    });
    await mkdir(join(dir, "eab-role"), { recursive: true });
    await writeFile(join(dir, "eab-role", "job-description.md"), "Low fit — 4.7/10");
    await drafter.enqueue(request());
    await drafter.runUntilIdle();
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /jd_unusable/);
    assert.match(report, /full job posting/i, "actionable guidance should invite pasting the full posting");
    assert.match(report, /(aggregator|employer careers page|blocked URL)/i, "guidance should mention replacing aggregator/blocked URLs");
    const pending = JSON.parse(await readFile(join(dir, "eab-role", "pending.json"), "utf8"));
    assert.equal(pending.progress.phase, "failed");
    await assert.rejects(readFile(join(dir, "eab-role", "resume.html")));
    await assert.rejects(readFile(join(dir, "eab-role", "cover-letter.html")));
  });

  it("returns accepted pending fields and deletes pending.json on publish", async () => {
    const drafter = createMaterialsDrafter(baseDeps(dir));
    const result = await drafter.enqueue(request());
    assert.equal(result.ok, true);
    assert.equal(result.accepted, true);
    assert.equal(result.slug, "eab-role");
    assert.equal(result.pending_path, join(dir, "eab-role", "pending.json"));
    assert.equal(typeof result.requested_at, "string");
    await drafter.runUntilIdle();
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /READY|REVIEW/);
    const run = JSON.parse(await readFile(join(dir, "eab-role", "run.json"), "utf8"));
    assert.ok(run.stages.some((s) => s.stage === "draft" && s.llm === true));
  });

  it("returns the existing pending for the same in-flight slug", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const stub = scriptedPipelineFetch({ gate });
    const drafter = createMaterialsDrafter(baseDeps(dir, { fetchImpl: stub.fetchImpl }));
    const first = await drafter.enqueue(request({ notes: "first" }));
    const second = await drafter.enqueue(request({ notes: "second should not start" }));
    assert.equal(second.pending_path, first.pending_path);
    assert.equal(second.requested_at, first.requested_at);
    release();
    await drafter.runUntilIdle();
    assert.ok(stub.calls.length <= 4, `duplicate enqueue must not start a second run (saw ${stub.calls.length} calls)`);
  });

  it("F13: failed pending carries a neutral code, never raw internals", async () => {
    const drafter = createMaterialsDrafter(
      baseDeps(dir, {
        resolvePin: async () => {
          throw new Error("boom: internal-secret-xyz");
        },
      }),
    );
    await drafter.enqueue(request());
    await drafter.runUntilIdle();
    const pending = JSON.parse(await readFile(join(dir, "eab-role", "pending.json"), "utf8"));
    assert.equal(pending.progress.phase, "failed");
    assert.ok(pending.progress.code, "a neutral code is present");
    assert.doesNotMatch(pending.progress.message, /secret|boom/);
    assert.ok(pending.debug && pending.debug.llm, "pending.json should include llm debug info");
  });

  it("passes payload.notes into the draft prompt as voice", async () => {
    const stub = scriptedPipelineFetch();
    const drafter = createMaterialsDrafter(baseDeps(dir, { fetchImpl: stub.fetchImpl }));
    await drafter.enqueue(request({ notes: "write like a human operator" }));
    await drafter.runUntilIdle();
    const draftCall = stub.calls.find((c) => c.system.includes("resume slots"));
    assert.ok(draftCall, "draft call issued");
    assert.match(draftCall.user, /write like a human operator/);
  });

  it("uses a usable JD provided in the request without scraping", async () => {
    let scraped = 0;
    const drafter = createMaterialsDrafter(
      baseDeps(dir, {
        scrapeJob: async () => {
          scraped += 1;
          throw new Error("scrape blocked");
        },
      }),
    );
    await drafter.enqueue(request({ jdText: JD_TEXT }));
    await drafter.runUntilIdle();
    await readFile(join(dir, "eab-role", "resume.html"), "utf8");
    await readFile(join(dir, "eab-role", "cover-letter.html"), "utf8");
    assert.ok(scraped <= 1, "scrape should not be required when a usable JD is provided");
  });

  it("F8: a snapshot repair edits the current draft with the notes as instructions", async () => {
    const first = createMaterialsDrafter(baseDeps(dir));
    await first.enqueue(request());
    await first.runUntilIdle();
    const before = JSON.parse(await readFile(join(dir, "eab-role", "draft.json"), "utf8"));
    assert.ok(before.statement, "first run stores its draft JSON beside resume.html");

    const stub = scriptedPipelineFetch();
    const repair = createMaterialsDrafter(baseDeps(dir, { fetchImpl: stub.fetchImpl }));
    await repair.enqueue(request({ resumeFrom: "snapshot", notes: "Fix the Córdoba typo" }));
    await repair.runUntilIdle();
    const draftCall = stub.calls.find((c) => c.system.includes("resume slots"));
    assert.ok(draftCall, "draft call issued");
    assert.match(draftCall.user, /REPAIR: edit the current draft/);
    assert.match(draftCall.user, /Instructions: Fix the Córdoba typo/);
    assert.match(draftCall.user, /Current draft:/);
    assert.doesNotMatch(draftCall.user, /Voice \(match it, never quote it\)/);
    const run = JSON.parse(await readFile(join(dir, "eab-role", "run.json"), "utf8"));
    assert.ok(
      (run.repairs || []).some((r) => r.code === "repair" && r.reenteredAt === "draft"),
      "run.json records the draft re-entry",
    );
  });

  it("reserves the same slug before any await so a concurrent enqueue is a no-op", async () => {
    const drafter = createMaterialsDrafter(baseDeps(dir));
    const payload = request();
    const [first, second] = await Promise.all([
      drafter.enqueue(payload),
      drafter.enqueue({ ...payload, notes: "loser" }),
    ]);
    assert.equal(second.pending_path, first.pending_path);
    assert.equal(second.requested_at, first.requested_at);
    await drafter.runUntilIdle();
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
  });
});
