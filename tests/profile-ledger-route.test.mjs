// F21: one claim ledger from resume.txt + profile.json, served read-only.
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { modelReplyFixture } from "./fixtures/materials-model-structure.mjs";
import { RESUME_STRUCTURE_SYSTEM_PROMPT } from "../server/materials-resume-structure-model.mjs";

const PORT = 38720 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MODEL_PORT = 38830 + Math.floor(Math.random() * 100);
const MODEL_URL = `http://127.0.0.1:${MODEL_PORT}`;
const RESUME_TEXT = "Jordan Rivera\nNorthwind — Manager, 2021-2026\n- Grew revenue 30% on a $2M book.\n";

let tmpDir = "";
let serverProcess = null;
let modelServer = null;

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    const r = await fetch(`${BASE_URL}/health`).catch(() => null);
    if (r && r.ok) return;
    await sleep(200);
  }
  throw new Error("ledger route server failed to start");
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jb-ledger-route-"));
  mkdirSync(join(tmpDir, ".jobbored"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".jobbored", "resume.txt"),
    RESUME_TEXT,
  );
  writeFileSync(join(tmpDir, "llm.json"), JSON.stringify({
    provider: "local",
    model: "stub",
    apiKey: "",
    baseUrl: MODEL_URL,
    updatedAt: "2026-09-28T00:00:00.000Z",
  }));
  modelServer = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const system = String(messages.find((message) => message.role === "system")?.content || "");
    const content = system === RESUME_STRUCTURE_SYSTEM_PROMPT
      ? JSON.stringify(modelReplyFixture(RESUME_TEXT))
      : "{}";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((resolve, reject) => {
    modelServer.once("error", reject);
    modelServer.listen(MODEL_PORT, "127.0.0.1", resolve);
  });
  serverProcess = spawn("node", ["index.mjs"], {
    cwd: join(import.meta.dirname, "..", "server"),
    env: {
      ...process.env,
      PORT: String(PORT),
      LISTEN_HOST: "127.0.0.1",
      JOBBORED_PROFILE_PATH: join(tmpDir, ".jobbored", "profile.json"),
      JOBBORED_LLM_CONFIG_PATH: join(tmpDir, "llm.json"),
      HERMES_LOGO_RESOLVER_SCRIPT: join(tmpDir, "missing-resolver.py"),
      HOME: tmpDir,
      USERPROFILE: tmpDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (modelServer) modelServer.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test("F21: GET /profile/ledger serves the built ledger with Saved in/Used by", async () => {
  const empty = await fetch(`${BASE_URL}/profile/ledger`);
  assert.equal(empty.status, 404);
  assert.equal((await empty.json()).reason, "no_ledger");

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
      strengths: [
        {
          name: "Backend systems",
          rank: 1,
          evidence: "Shipped services handling 10k RPS with Postgres and Kafka.",
          keywords: ["Postgres"],
        },
      ],
      hardConstraints: { workMode: "any" },
    }),
  });
  assert.equal(post.status, 200);
  const saved = await post.json();
  assert.equal(saved.ok, true);
  assert.equal(saved.ledger.ok, true);
  assert.equal(saved.ledger.ingest.status, "ready");
  assert.ok(saved.ledger.claims >= 2);

  const get = await fetch(`${BASE_URL}/profile/ledger`);
  assert.equal(get.status, 200);
  const data = await get.json();
  assert.equal(data.ok, true);
  assert.equal(data.ledger.contract, "materials.claim-ledger.v1");
  assert.match(data.savedIn, /claim-ledger\.json$/);
  assert.deepEqual(data.usedBy, ["materials"]);
  assert.ok(
    data.ledger.claims.some((c) => c.id === "profile-strength-1"),
    "strength evidence claim present",
  );
  assert.ok(
    data.ledger.claims.some((c) => c.employerId === "northwind"),
    "resume bullet attributed to the resume employer",
  );
});
