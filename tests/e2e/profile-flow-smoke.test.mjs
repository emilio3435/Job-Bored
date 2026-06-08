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
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 38470 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
let tmpDir = "";
let profilePath = "";
let workerConfigPath = "";
let serverProcess = null;
let openRouterMockServer = null;
let openRouterBaseUrl = "";
const openRouterRequests = [];

function readRequestBody(req) {
  return new Promise((resolveBody) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolveBody(body));
  });
}

function buildProfileDraft() {
  return {
    version: 1,
    starterTemplate: "custom",
    identity: {
      targetRoles: ["Platform Engineer", "Backend Engineer"],
      targetSeniority: "ic_senior",
      yearsRelevantExperience: 8,
      primaryNarrative:
        "I'm a backend platform engineer focused on reliable services, developer tooling, and practical AI integrations.",
    },
    strengths: [
      {
        name: "backend platforms",
        rank: 1,
        evidence: "Built internal APIs and automation.",
        keywords: ["Node.js", "APIs", "automation"],
      },
    ],
    wants: [],
    avoids: [],
    hardConstraints: {
      workMode: "any",
      salaryRequired: false,
      acceptableLocations: [],
      workAuth: "us_authorized",
    },
  };
}

async function startOpenRouterMock() {
  openRouterMockServer = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    openRouterRequests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(buildProfileDraft()),
            },
          },
        ],
      }),
    );
  });
  await new Promise((resolveListen) => {
    openRouterMockServer.listen(0, "127.0.0.1", resolveListen);
  });
  const address = openRouterMockServer.address();
  openRouterBaseUrl = `http://127.0.0.1:${address.port}/v1`;
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jobbored-e2e-"));
  profilePath = join(tmpDir, "profile.json");
  workerConfigPath = join(tmpDir, "worker-config.json");
  await startOpenRouterMock();
  serverProcess = spawn("node", ["index.mjs"], {
    cwd: resolve("server"),
    env: {
      ...process.env,
      PORT: String(PORT),
      JOBBORED_PROFILE_PATH: profilePath,
      BROWSER_USE_DISCOVERY_CONFIG_PATH: workerConfigPath,
      HERMES_RESUME_TEMPLATE_DIR: join(tmpDir, "resume-template"),
      LISTEN_HOST: "127.0.0.1",
      PROFILE_PROVIDER: "openrouter",
      PROFILE_OPENROUTER_API_KEY: "sk-or-profile-test",
      PROFILE_OPENROUTER_BASE_URL: openRouterBaseUrl,
      PROFILE_OPENROUTER_MODEL: "openrouter/profile-test",
      ATS_GEMINI_API_KEY: "",
      GEMINI_API_KEY: "",
      // Redirect the home dir so filesystem resume lookups are hermetic. The
      // /profile/from-resume route reads ~/.jobbored/resume.txt and
      // ~/.hermes/job-hunt/profile/resume*.md via os.homedir() with no env
      // override — so on a dev box that has a legacy hermes resume the
      // "no resume stored" precondition is false and the endpoint returns a
      // real 200 draft instead of 404. HOME (POSIX) and USERPROFILE (Windows)
      // both back os.homedir().
      HOME: tmpDir,
      USERPROFILE: tmpDir,
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
  if (openRouterMockServer) openRouterMockServer.close();
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
  // HOME is redirected to an empty temp dir in before(), so none of the resume
  // lookup locations resolve (worker-config resumeText is empty in the repo,
  // ~/.jobbored/resume.txt and ~/.hermes/.../resume*.md live under the temp
  // home). The endpoint must take the clean no-resume path on any machine.
  const r = await fetch(`${BASE_URL}/profile/from-resume`, { method: "POST" });
  assert.equal(r.status, 404);
  const data = await r.json();
  assert.equal(data.ok, false);
  assert.equal(data.reason, "no_resume_stored");
});

test("POST /profile/from-resume drafts a profile through OpenRouter chat JSON with no Gemini key", async () => {
  mkdirSync(dirname(workerConfigPath), { recursive: true });
  writeFileSync(
    workerConfigPath,
    JSON.stringify({
      candidateProfile: {
        resumeText:
          "Senior backend engineer with Node.js APIs, automation, platform tooling, and AI integration experience.",
      },
    }),
  );
  openRouterRequests.length = 0;

  const r = await fetch(`${BASE_URL}/profile/from-resume`, { method: "POST" });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.equal(data.source, "worker_config");
  assert.equal(data.profile.version, 1);
  assert.equal(data.profile.identity.targetSeniority, "ic_senior");
  assert.deepEqual(data.profile.identity.targetRoles.slice(0, 2), [
    "Platform Engineer",
    "Backend Engineer",
  ]);
  assert.equal(data.profile.strengths[0].rank, 1);

  assert.equal(openRouterRequests.length, 1);
  const request = openRouterRequests[0];
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(request.headers.authorization, "Bearer sk-or-profile-test");
  const body = JSON.parse(request.body);
  assert.equal(body.model, "openrouter/profile-test");
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 3500);
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");
  assert.match(body.messages[0].content, /strict JSON object/);
  assert.match(body.messages[1].content, /Senior backend engineer/);
  assert.doesNotMatch(request.body, /responseSchema|systemInstruction|generateContent/);
});
