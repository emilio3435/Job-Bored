// F7/E13 guard: POST /profile must never write into the repo. The logo
// manifest writer once fell back to the tracked
// integrations/hermes-job-hunt/resume-template/logos.json whenever the
// Hermes template dir was absent, so a plain profile save dirtied the
// checkout with user employer names. This boots the API with a sandbox
// HOME and no Hermes env overrides, saves a profile with experiences,
// and asserts the tracked file (and the worktree) is untouched.
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";

const repoRoot = resolve(import.meta.dirname ?? process.cwd(), "..");
const trackedLogos = join(
  repoRoot,
  "integrations",
  "hermes-job-hunt",
  "resume-template",
  "logos.json",
);

const PORT = 38620 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let tmpDir = "";
let serverProcess = null;

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitStatus() {
  const out = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(out.status, 0, `git status failed: ${out.stderr}`);
  return out.stdout;
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    const r = await fetch(`${BASE_URL}/health`).catch(() => null);
    if (r && r.ok) return;
    await sleep(200);
  }
  throw new Error("F7 guard server failed to start");
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jb-f7-guard-"));
  const stub = join(tmpDir, "resolver-stub.py");
  writeFileSync(stub, "#!/usr/bin/env python3\nprint('0 marks: stub')\n", "utf8");
  chmodSync(stub, 0o755);
  const env = { ...process.env };
  delete env.HERMES_RESUME_TEMPLATE_DIR;
  delete env.HERMES_JOB_HUNT_ROOT;
  delete env.HERMES_ROOT;
  delete env.JOBBORED_HOME;
  delete env.JOBBORED_LOGOS_DIR;
  serverProcess = spawn("node", ["index.mjs"], {
    cwd: join(repoRoot, "server"),
    env: {
      ...env,
      PORT: String(PORT),
      LISTEN_HOST: "127.0.0.1",
      JOBBORED_PROFILE_PATH: join(tmpDir, "profile.json"),
      HERMES_LOGO_RESOLVER_SCRIPT: stub,
      HOME: tmpDir,
      USERPROFILE: tmpDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test("F7/E13: POST /profile leaves the tracked repo untouched", async () => {
  const beforeHash = sha256File(trackedLogos);
  const beforeStatus = gitStatus();
  const post = await fetch(`${BASE_URL}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1,
      identity: {
        targetRoles: ["Staff Engineer"],
        targetSeniority: "ic_staff",
        primaryNarrative: "Staff engineer who builds durable distributed systems for people.",
      },
      strengths: [{ name: "backend systems", rank: 1 }],
      experiences: [
        { slug: "probe-corp", company: "Probe Corp", title: "Engineer", logoDomain: "probe.test" },
      ],
      hardConstraints: { workMode: "any" },
    }),
  });
  assert.equal(post.status, 200);
  assert.equal((await post.json()).ok, true);
  assert.equal(sha256File(trackedLogos), beforeHash, "tracked logos.json was rewritten");
  assert.equal(gitStatus(), beforeStatus, "POST /profile dirtied the worktree");
});
