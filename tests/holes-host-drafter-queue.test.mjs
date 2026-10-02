/**
 * HOLES HOST S4 (drafter half): the in-process drafting FIFO had no length
 * limit, so a client loop (or a leaked hosted token) could queue unbounded
 * LLM- and Chromium-heavy runs. Past the cap a new request is a 429 the
 * browser may retry; a "Draft both" follow-up letter is never refused.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { scriptedMrevFetch } from "./materials-mrev-stub.test.mjs";

const RESUME = {
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
const PIN = { provider: "local", model: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };

/** @param {string} slug */
function request(slug, extra = {}) {
  return { resume: RESUME, slug, company: "Acme Analytics", title: "Data Platform Engineer", feature: "resume", jobUrl: "https://example.com/job", notes: "", ...extra };
}

describe("HOLES HOST S4 — drafter queue cap", () => {
  let dir = "";
  /** @type {Record<string, string | undefined>} */
  let prior = {};
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "holes-host-queue-"));
    prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, JOBBORED_HOME: process.env.JOBBORED_HOME, JOBBORED_PROFILE_PATH: process.env.JOBBORED_PROFILE_PATH };
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    process.env.JOBBORED_HOME = join(dir, ".jobbored");
    process.env.JOBBORED_PROFILE_PATH = join(dir, ".jobbored", "profile.json");
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("answers a retryable 429 once the queue is full", async () => {
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const drafter = createMaterialsDrafter({
      applicationsRoot: join(dir, "applications"),
      loadPin: () => PIN,
      // Holds the first run in progress, then fails every run before any
      // model call: this test is about admission only.
      resolvePin: async () => {
        await gate;
        throw new Error("stop before any model call");
      },
      readSavedResume: async () => null,
      openSession: null,
      intel: false,
      logoLoader: async () => [],
      targetLogoLoader: async () => null,
      employerLogoLoader: async () => [],
      maxQueued: 1,
    });
    await drafter.enqueue(request("role-a", { jobDescription: JD_TEXT })); // running
    await drafter.enqueue(request("role-b", { jobDescription: JD_TEXT })); // waiting: the queue is full
    await assert.rejects(drafter.enqueue(request("role-c", { jobDescription: JD_TEXT })), (err) => {
      const error = /** @type {{ statusCode?: number, code?: string, retryable?: boolean }} */ (err);
      assert.equal(error.statusCode, 429);
      assert.equal(error.code, "materials_queue_full");
      assert.equal(error.retryable, true);
      return true;
    });
    // A repeat request for a role already in line is still the same request.
    const again = await drafter.enqueue(request("role-b", { jobDescription: JD_TEXT }));
    assert.equal(again.accepted, true);
    release();
    await drafter.runUntilIdle();
    const accepted = await drafter.enqueue(request("role-c", { jobDescription: JD_TEXT }));
    assert.equal(accepted.accepted, true, "an emptied queue admits again");
    await drafter.runUntilIdle();
  });

  it("never refuses a Draft-both letter, even when the queue is full", async () => {
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const stub = scriptedMrevFetch({ gate, gateAt: 4 });
    const appsRoot = join(dir, "applications");
    const drafter = createMaterialsDrafter({
      applicationsRoot: appsRoot,
      loadPin: () => PIN,
      resolvePin: async (loaded) => ({ ...(/** @type {object} */ (loaded)), resolvedModel: "stub" }),
      scrapeJob: async () => ({ description: JD_TEXT }),
      fetchImpl: stub.fetchImpl,
      readSavedResume: async () => null,
      openSession: null,
      logoLoader: async () => [],
      targetLogoLoader: async () => null,
      employerLogoLoader: async () => [],
      maxQueued: 1,
    });
    await drafter.enqueue(request("role-a", { then: "cover_letter" })); // running, held at the gate
    await drafter.enqueue(request("role-b")); // fills the queue
    release();
    await drafter.runUntilIdle();
    const runsA = await readdir(join(appsRoot, "role-a", "runs"));
    assert.equal(runsA.length, 2, `the resume and its letter both ran, got ${runsA.join(", ")}`);
  });
});
