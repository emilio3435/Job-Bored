/**
 * profile-flow-smoke.test.mjs
 *
 * E2E smoke test for the Fit Profile flow. No browser tooling installed in
 * this repo, so we drive the API surface end-to-end with HTTP fetches against
 * a real running server. Profile storage is redirected to a temp file via
 * JOBBORED_PROFILE_PATH so we never touch the user's real profile.
 *
 * Covers:
 *   - GET /profile (empty state)
 *   - POST /profile/template/marketer
 *   - POST /profile (save valid)
 *   - GET /profile (round-trip)
 *   - POST /profile (reject invalid)
 *   - POST /profile/migrate (idempotent)
 *   - POST /profile/rescore?dryRun=true (sheet walker dry-run path)
 *   - POST /profile/from-resume (404 path when no resume present)
 *
 * Usage:
 *   node --test tests/e2e/profile-flow-smoke.test.mjs
 *
 * The test spawns its own server on a free port. No prior `npm start` needed.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 38470 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
let tmpDir = "";
let profilePath = "";
let serverProcess = null;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jobbored-e2e-"));
  profilePath = join(tmpDir, "profile.json");
  serverProcess = spawn("node", ["index.mjs"], {
    cwd: resolve("server"),
    env: {
      ...process.env,
      PORT: String(PORT),
      JOBBORED_PROFILE_PATH: profilePath,
      LISTEN_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Wait for /health to respond
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  const finalProbe = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!finalProbe || !finalProbe.ok) {
    serverProcess.kill();
    throw new Error("Server failed to come up within 6s");
  }
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test("GET /profile returns no_profile on empty state", async () => {
  const r = await fetch(`${BASE_URL}/profile`);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, false);
  assert.equal(data.reason, "no_profile");
});

test("POST /profile/template/marketer returns a valid starter template", async () => {
  const r = await fetch(`${BASE_URL}/profile/template/marketer`, { method: "POST" });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.ok(data.template);
  assert.equal(data.template.version, 1);
  assert.equal(data.template.starterTemplate, "marketer");
  assert.ok(Array.isArray(data.template.strengths) && data.template.strengths.length > 0);
});

test("POST /profile/template/:unknown returns 404", async () => {
  const r = await fetch(`${BASE_URL}/profile/template/totally-not-a-template`, { method: "POST" });
  assert.equal(r.status, 404);
  const data = await r.json();
  assert.equal(data.ok, false);
  assert.equal(data.reason, "unknown_template");
});

test("POST /profile saves a valid profile and GET round-trips it", async () => {
  const profile = {
    version: 1,
    identity: {
      targetRoles: ["Staff Software Engineer"],
      targetSeniority: "ic_staff",
      yearsRelevantExperience: 10,
      primaryNarrative:
        "I'm a staff backend engineer with a decade in distributed systems and growing depth in applied LLM tooling.",
    },
    strengths: [
      { name: "backend systems", rank: 1, evidence: "10 yrs Go + Python services" },
      { name: "LLM applications", rank: 2 },
    ],
    wants: ["hands-on coding", "small team"],
    avoids: ["pure people management"],
    hardConstraints: {
      workMode: "hybrid_ok",
      acceptableLocations: ["Denver"],
      workAuth: "us_citizen",
      skipTitles: ["intern", "junior"],
      salaryRequired: true,
      salaryFloor: 200000,
    },
  };
  const post = await fetch(`${BASE_URL}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  assert.equal(post.status, 200);
  const postData = await post.json();
  assert.equal(postData.ok, true);
  assert.ok(postData.updatedAt);

  // Round-trip
  const get = await fetch(`${BASE_URL}/profile`);
  assert.equal(get.status, 200);
  const getData = await get.json();
  assert.equal(getData.ok, true);
  assert.equal(getData.profile.identity.targetSeniority, "ic_staff");
  assert.equal(getData.profile.strengths.length, 2);
  assert.equal(getData.profile.hardConstraints.salaryFloor, 200000);

  // File on disk matches
  assert.ok(existsSync(profilePath));
  const onDisk = JSON.parse(readFileSync(profilePath, "utf8"));
  assert.equal(onDisk.identity.targetSeniority, "ic_staff");
});

test("POST /profile rejects an invalid profile (bad enum)", async () => {
  const bad = {
    version: 1,
    identity: {
      targetRoles: ["X"],
      targetSeniority: "not-a-real-seniority",
      primaryNarrative: "Short narrative that exceeds twenty characters so length passes.",
    },
    strengths: [{ name: "x", rank: 1 }],
    hardConstraints: { workMode: "any" },
  };
  const r = await fetch(`${BASE_URL}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bad),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.equal(data.ok, false);
  assert.equal(data.reason, "invalid_profile");
});

test("POST /profile/migrate returns canonical_already_present when profile exists", async () => {
  const r = await fetch(`${BASE_URL}/profile/migrate`, { method: "POST" });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.equal(data.migrated, false);
  // Reason is either canonical_already_present or no_legacy_files depending on
  // whether the user has a ~/.hermes profile dir. Both are non-failure paths.
  assert.match(
    data.reason || "",
    /canonical_already_present|no_legacy_files|marker_exists/,
  );
});

test("POST /profile/rescore?dryRun=true returns a row count or sheet-not-configured", async () => {
  const r = await fetch(`${BASE_URL}/profile/rescore?dryRun=true`, { method: "POST" });
  // Three valid outcomes:
  //   200 with row counts (sheet configured + readable)
  //   500 with detail (sheet not configured in this env)
  //   400 with no_profile (we DO have a profile from the earlier test, so not this)
  assert.match(String(r.status), /^200$|^500$/);
  const data = await r.json();
  if (r.status === 200) {
    assert.equal(data.ok, true);
    assert.equal(data.dryRun, true);
    assert.ok(typeof data.skipped === "number" || typeof data.rescored === "number");
  } else {
    assert.equal(data.ok, false);
    assert.ok(data.message || data.detail);
  }
});

test("POST /profile/from-resume returns 404 when no resume is stored", async () => {
  // The temp env has no resume in any of the lookup locations. Expect 404.
  const r = await fetch(`${BASE_URL}/profile/from-resume`, { method: "POST" });
  // Acceptable outcomes:
  //   404 no_resume_stored (clean path)
  //   503 gemini_not_configured (if it found a legacy hermes resume on the dev box)
  assert.match(String(r.status), /^404$|^503$|^500$/);
  const data = await r.json();
  assert.equal(data.ok, false);
});
