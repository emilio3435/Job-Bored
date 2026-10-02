import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { format } from "node:util";

import { atsFailureResponse } from "../server/ats-route-errors.mjs";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { createProfileFromResumeHandler } from "../server/profile-from-resume.mjs";
import { createRouteLimiter, isLimitedRoute } from "../server/route-limits.mjs";
import { EXAMPLE_RESUME_SOURCE } from "./fixtures/materials-pipeline-stub.mjs";
import { scriptedMrevFetch } from "./materials-mrev-stub.test.mjs";

test("S4 review: saved-key judge-models requests consume the limiter budget", () => {
  assert.equal(isLimitedRoute("POST", "/api/llm-config/judge-models"), true);
  const limiter = createRouteLimiter({ perMinute: 1, concurrency: 2 });
  const first = admit(limiter, "/api/llm-config/judge-models");
  assert.equal(first.passed, true);
  first.res.emit("finish");
  const next = admit(limiter, "/api/llm-config/judge-models");
  assert.equal(next.passed, false);
  assert.equal(next.res.statusCode, 429);
  assert.equal(next.res.body.retryable, true);
});

function admit(limiter, path = "/api/applications/acme/request") {
  let passed = false;
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200, body: null,
    setHeader() {},
    end() { return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  });
  limiter({ method: "POST", path }, res, () => { passed = true; });
  return { res, passed };
}

test("S4 review: disconnected requests retain capacity until their work finishes", () => {
  const limiter = createRouteLimiter({ perMinute: 100, concurrency: 1 });
  const first = admit(limiter);
  assert.equal(first.passed, true);
  first.res.emit("close");
  assert.equal(admit(limiter).passed, false, "disconnect must not admit more work");
  first.res.emit("finish");
  assert.equal(admit(limiter).passed, true, "completion releases the slot");
});

test("S4 review: a completed response to a disconnected client releases capacity once", () => {
  const limiter = createRouteLimiter({ perMinute: 100, concurrency: 1 });
  const first = admit(limiter);
  first.res.destroyed = true;
  first.res.emit("close");
  assert.equal(admit(limiter).passed, false);
  first.res.end(); // A destroyed response never emits finish.
  assert.equal(admit(limiter).passed, true, "completion still frees the occupied slot");
  first.res.emit("finish");
  assert.equal(admit(limiter).passed, false, "completion cannot free someone else's slot");
});

test("P9 review: arbitrary required/invalid/must-be errors remain generic 500s", () => {
  for (const message of ["required system file /srv/private", "invalid internal configuration", "provider key must be sk-example"] ) {
    assert.deepEqual(atsFailureResponse(new Error(message)), {
      status: 500, body: { error: "ATS scoring failed.", code: "internal_error" },
    });
  }
  assert.equal(atsFailureResponse(new Error('Invalid event. Expected "command-center.ats-scorecard".')).status, 400);
});

test("S12 review: profile route returns fixed provider errors and logs only redacted text", async () => {
  const original = console.warn;
  const logs = [];
  const key = "sk-holesreview012345678901234567890";
  console.warn = (...args) => logs.push(format(...args));
  try {
    for (const code of ["gemini_http_error", "profile_provider_error", "gemini_not_configured", "profile_provider_not_configured"]) {
      const handler = createProfileFromResumeHandler({
        analyze: async () => {
          throw Object.assign(new Error(`Upstream private diagnostic at /srv/hidden ?key=${key}`), {
            code, provider: "gemini", response: { body: "PRIVATE-UPSTREAM-BODY" },
          });
        },
        signalFor: () => undefined,
      });
      const res = { statusCode: 200, body: null, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
      await handler({ body: { resumeText: EXAMPLE_RESUME_SOURCE.text } }, res);
      assert.equal(res.statusCode, code.endsWith("not_configured") ? 409 : 500);
      assert.equal(res.body.message, code.endsWith("not_configured") ? "Configure an AI provider in Settings → AI." : "The AI provider could not read the resume. Try again or check Settings → AI.");
      assert.doesNotMatch(JSON.stringify(res.body), /private diagnostic|hidden|sk-holesreview/);
    }
    assert.equal(logs.length, 4, "provider failures are logged");
    assert.ok(logs.every((line) => !line.includes(key) && !line.includes("PRIVATE-UPSTREAM-BODY")));
  } finally {
    console.warn = original;
  }
});

const PIN = { provider: "local", model: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
const POSTING = Array(120).fill("Own the roadmap and ship measurable outcomes.").join(" ");
const request = (slug, extra = {}) => ({ slug, resume: EXAMPLE_RESUME_SOURCE, company: "Acme", title: "Manager", feature: "resume", jobDescription: POSTING, notes: "", ...extra });

test("S4 review: concurrent enqueues reserve capacity before reading the saved resume", async () => {
  const root = mkdtempSync(join(tmpdir(), "holes-host-admission-"));
  let release;
  const gate = new Promise((done) => { release = done; });
  const drafter = createMaterialsDrafter({
    applicationsRoot: join(root, "applications"), maxQueued: 1,
    loadPin: () => PIN, resolvePin: async () => { throw new Error("test stops before model calls"); },
    readSavedResume: async () => { await gate; return null; },
    openSession: null, intel: false,
  });
  try {
    const pending = Promise.allSettled(["role-a", "role-b", "role-c"].map((slug) => drafter.enqueue(request(slug))));
    release();
    const results = await pending;
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      assert.equal(r.reason.code, "materials_queue_full");
      assert.equal(r.reason.statusCode, 429);
      assert.equal(r.reason.retryable, true);
    }
    await drafter.runUntilIdle();
    assert.equal((await drafter.enqueue(request("role-after"))).accepted, true, "finished admissions release capacity");
    await drafter.runUntilIdle();
  } finally {
    release();
    await drafter.runUntilIdle();
    rmSync(root, { recursive: true, force: true });
  }
});

test("S17 review: follow-up enqueue failures do not log enumerable headers or bodies", async () => {
  const root = mkdtempSync(join(tmpdir(), "holes-host-followup-"));
  const prior = process.env.JOBBORED_PROFILE_PATH;
  process.env.JOBBORED_PROFILE_PATH = join(root, "profile.json");
  const original = console.error;
  const logs = [];
  console.error = (...args) => logs.push(format(...args));
  let loads = 0;
  const key = "sk-" + "holesfollowup012345678901234567890";
  const stub = scriptedMrevFetch();
  const drafter = createMaterialsDrafter({
    applicationsRoot: join(root, "applications"),
    loadPin: () => {
      if (++loads > 1) throw Object.assign(new Error(`Follow-up failed ?key=${key}`), { headers: { authorization: key }, body: "PRIVATE-FOLLOWUP-BODY" });
      return PIN;
    },
    resolvePin: async () => ({ ...PIN, resolvedModel: "stub" }),
    readSavedResume: async () => null, fetchImpl: stub.fetchImpl,
    openSession: null, intel: false, logoLoader: async () => [], employerLogoLoader: async () => [], targetLogoLoader: async () => null,
  });
  try {
    await drafter.enqueue(request("follow-up", { then: "cover_letter" }));
    await drafter.runUntilIdle();
    const line = logs.find((entry) => entry.includes("follow-up cover_letter not queued"));
    assert.ok(line, "the completed resume attempted its letter");
    assert.ok(!line.includes(key), "message/header key redacted");
    assert.ok(!line.includes("PRIVATE-FOLLOWUP-BODY"), "enumerable error body omitted");
  } finally {
    console.error = original;
    if (prior === undefined) delete process.env.JOBBORED_PROFILE_PATH; else process.env.JOBBORED_PROFILE_PATH = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
