import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  createMaterialsDrafter,
  reconcileOrphanedPending,
} from "../server/materials-drafter.mjs";
import { EXAMPLE_RESUME_SOURCE, scriptedPipelineFetch } from "./fixtures/materials-pipeline-stub.mjs";

const pin = { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "" };

function pendingRecord(overrides = {}) {
  return {
    slug: "old-role",
    company: "Old Co",
    title: "Engineer",
    feature: "resume",
    job_url: "",
    notes: "",
    requested_at: "2026-09-20T00:00:00.000Z",
    source: "jobbored-dossier",
    progress: {
      phase: "queued",
      message: "queued",
      started_at: "",
      updated_at: "2026-09-20T00:00:00.000Z",
      attempt: 1,
      elapsed_seconds: 0,
    },
    ...overrides,
  };
}

describe("F14: orphaned pending", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-fifo-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("marks pre-restart queued/drafting pending failed with a retry prompt", async () => {
    await mkdir(join(dir, "old-role"), { recursive: true });
    await writeFile(join(dir, "old-role", "pending.json"), JSON.stringify(pendingRecord()));
    const out = await reconcileOrphanedPending({ applicationsRoot: dir });
    assert.equal(out.reconciled, 1);
    const pending = JSON.parse(await readFile(join(dir, "old-role", "pending.json"), "utf8"));
    assert.equal(pending.progress.phase, "failed");
    assert.equal(pending.progress.code, "materials_interrupted");
    assert.match(pending.progress.message, /restarted|try again/i);
  });

  it("leaves fresh and terminal pending alone", async () => {
    const now = "2026-09-26T03:30:00.000Z";
    await mkdir(join(dir, "fresh-role"), { recursive: true });
    await writeFile(
      join(dir, "fresh-role", "pending.json"),
      JSON.stringify(
        pendingRecord({
          slug: "fresh-role",
          progress: { ...pendingRecord().progress, updated_at: now },
        }),
      ),
    );
    await mkdir(join(dir, "failed-role"), { recursive: true });
    await writeFile(
      join(dir, "failed-role", "pending.json"),
      JSON.stringify(
        pendingRecord({
          slug: "failed-role",
          progress: { ...pendingRecord().progress, phase: "failed", updated_at: "2026-09-20T00:00:00.000Z" },
        }),
      ),
    );
    const out = await reconcileOrphanedPending({ applicationsRoot: dir, nowMs: Date.parse(now) });
    assert.equal(out.reconciled, 0);
    const fresh = JSON.parse(await readFile(join(dir, "fresh-role", "pending.json"), "utf8"));
    assert.equal(fresh.progress.phase, "queued");
  });

  it("heartbeats queued jobs so a long queue never goes stale", async () => {
    let releaseFirst;
    const gate = new Promise((r) => {
      releaseFirst = r;
    });
    const stub = scriptedPipelineFetch({ gate });
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => pin,
      resolvePin: async (loaded) => ({ ...loaded, resolvedModel: "m" }),
      scrapeJob: async () => ({ description: "word ".repeat(100) }),
      fetchImpl: stub.fetchImpl,
      openSession: null,
      logoLoader: async () => [],
      heartbeatMs: 25,
    });
    const payload = (slug) => ({
      resume: EXAMPLE_RESUME_SOURCE,
      slug,
      company: "Co",
      title: "Engineer",
      feature: "resume",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.enqueue(payload("first-role"));
    await drafter.enqueue(payload("second-role"));
    const before = JSON.parse(await readFile(join(dir, "second-role", "pending.json"), "utf8"));
    await new Promise((r) => setTimeout(r, 120));
    const during = JSON.parse(await readFile(join(dir, "second-role", "pending.json"), "utf8"));
    assert.equal(during.progress.phase, "queued");
    assert.ok(
      Date.parse(during.progress.updated_at) > Date.parse(before.progress.updated_at),
      "queued pending was not heartbeated",
    );
    releaseFirst();
    await drafter.runUntilIdle();
  });
});
