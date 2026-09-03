import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* ============================================================
   An unconfigured provider is the client's state, not a server fault.

   Greenfield walkthrough 2026-09-02, step 12: Beat 2 was left without a
   key, Beat 3 still sent the stored default provider, and
   POST /profile/from-resume answered 500 "Missing Gemini API key. Go back
   and reconnect Gemini". A 500 reads as "the drafter broke"; the truth is
   "you have not connected a provider yet", which the dashboard can route
   to the AI step — but only if the status says so. 409 now, with the same
   reason codes the dashboard already keys on.

   Boots the real server on a spare port with HOME redirected, so the
   route's resume write lands in a temp dir and no machine credential or
   ~/.jobbored/llm.json pin can leak into the answer.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 38570 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RESUME = "Senior Product Designer, Design Systems. Eight years at B2B SaaS.";

let serverProcess;
let tmpDir;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jobbored-unconfigured-provider-"));
  serverProcess = spawn(process.execPath, ["index.mjs"], {
    cwd: join(repoRoot, "server"),
    env: {
      ...process.env,
      PORT: String(PORT),
      LISTEN_HOST: "127.0.0.1",
      HOME: tmpDir,
      USERPROFILE: tmpDir,
      JOBBORED_HOME: join(tmpDir, ".jobbored"),
      JOBBORED_PROFILE_PATH: join(tmpDir, "profile.json"),
      BROWSER_USE_DISCOVERY_CONFIG_PATH: join(tmpDir, "worker-config.json"),
      HERMES_RESUME_TEMPLATE_DIR: join(tmpDir, "resume-template"),
      // No provider configured anywhere on the server side.
      PROFILE_PROVIDER: "",
      PROFILE_OPENROUTER_API_KEY: "",
      PROFILE_GEMINI_API_KEY: "",
      ATS_GEMINI_API_KEY: "",
      GEMINI_API_KEY: "",
      OPENROUTER_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  serverProcess.kill();
  throw new Error("server did not come up in time");
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

async function draft(body) {
  const res = await fetch(`${BASE_URL}/profile/from-resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resumeText: RESUME, ...body }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe("POST /profile/from-resume with a provider that has no key", () => {
  it("answers 409 profile_provider_not_configured for a keyless OpenRouter pick", async () => {
    const { status, json } = await draft({ provider: "openrouter", apiKey: "" });
    assert.equal(status, 409, "client configuration, not a server fault");
    assert.equal(json && json.reason, "profile_provider_not_configured");
    assert.equal(json && json.ok, false);
  });

  it("answers 409 gemini_not_configured for a keyless Gemini pick", async () => {
    const { status, json } = await draft({ provider: "gemini", apiKey: "" });
    assert.equal(status, 409);
    assert.equal(json && json.reason, "gemini_not_configured");
  });
});
