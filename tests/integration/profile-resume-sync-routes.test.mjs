import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* ============================================================
   RESJ K1 + K2 over HTTP — the real server, HOME redirected.

   PUT  /profile/resume           the browser's resume reaches the
                                  server's canonical resume.txt
   POST /profile/contact/suggest  garbled or empty browser text falls
                                  back to the saved resume; both usable
                                  → each field from whichever has it
   Fictional resumes only.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 38780 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GARBLED = readFileSync(join(repoRoot, "tests", "fixtures", "materials-garbled-resume.txt"), "utf8");

/* Full header: name, headline, email, phone, place, LinkedIn. */
const CLEAN = `Jordan Rivera
Growth Marketing Leader
Austin, TX | (512) 555-0147 | jordan.rivera@example.com | linkedin.com/in/jordan-rivera

Experience
Director of Growth, Northwind Outfitters, 2019 to 2025
- Grew qualified pipeline 38% in two years by rebuilding lifecycle email.
`;

/* A newer resume with a new email but no phone or place on it. */
const PARTIAL = `Jordan Rivera
Head of Growth
jordan@rivera.example.org

Experience
Head of Growth, Contoso Labs, 2025 to present
- Launched the self-serve funnel.
`;

let serverProcess;
let tmpDir;
let resumePath;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jobbored-resume-sync-"));
  resumePath = join(tmpDir, "resume.txt");
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

beforeEach(() => {
  rmSync(resumePath, { force: true });
});

describe("PUT /profile/resume (K1)", () => {
  it("should write the browser's resume to resume.txt beside profile.json", async () => {
    const { status, body } = await send("PUT", "/profile/resume", { resumeText: CLEAN });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.chars, CLEAN.trim().length);
    assert.equal(typeof body.savedAt, "string");
    assert.equal(readFileSync(resumePath, "utf8").trim(), CLEAN.trim());
    assert.deepEqual(
      readdirSync(tmpDir).filter((name) => name.endsWith(".tmp")),
      [],
      "the temp file is renamed into place, never left behind",
    );
  });

  it("should refuse empty text with a 400 and write nothing", async () => {
    const { status, body } = await send("PUT", "/profile/resume", { resumeText: "   " });
    assert.equal(status, 400);
    assert.equal(body.reason, "resume_empty");
    assert.equal(existsSync(resumePath), false);
  });

  it("should refuse text over the size cap with a 413", async () => {
    const { status, body } = await send("PUT", "/profile/resume", { resumeText: `${CLEAN}\n${"x ".repeat(31_000)}` });
    assert.equal(status, 413);
    assert.equal(body.reason, "resume_too_long");
    assert.equal(existsSync(resumePath), false);
  });

  it("should refuse garbled PDF text and keep the good saved resume", async () => {
    writeFileSync(resumePath, CLEAN);
    const { status, body } = await send("PUT", "/profile/resume", { resumeText: GARBLED });
    assert.equal(status, 422);
    assert.equal(body.reason, "resume_garbled");
    assert.equal(readFileSync(resumePath, "utf8"), CLEAN, "the saved resume is untouched");
  });
});

describe("POST /profile/contact/suggest source choice (K2)", () => {
  it("should fill from the saved resume when the browser sends garbled text", async () => {
    writeFileSync(resumePath, CLEAN);
    const { status, body } = await send("POST", "/profile/contact/suggest", { resumeText: GARBLED });
    assert.equal(status, 200);
    assert.equal(body.source, "stored");
    assert.equal(body.requestGarbled, true);
    assert.equal(body.values.fullName, "Jordan Rivera");
    assert.equal(body.values.email, "jordan.rivera@example.com");
    assert.equal(body.values.phone, "(512) 555-0147");
    assert.deepEqual(body.values.location, { city: "Austin", state: "TX" });
  });

  it("should fill from the saved resume when the browser sends nothing", async () => {
    writeFileSync(resumePath, CLEAN);
    const { body } = await send("POST", "/profile/contact/suggest", {});
    assert.equal(body.source, "stored");
    assert.equal(body.values.fullName, "Jordan Rivera");
  });

  it("should take each field from whichever source has it, the browser's text first", async () => {
    writeFileSync(resumePath, CLEAN);
    const { body } = await send("POST", "/profile/contact/suggest", { resumeText: PARTIAL });
    assert.equal(body.source, "merged");
    assert.equal(body.values.email, "jordan@rivera.example.org", "the browser's newer email wins");
    assert.equal(body.values.headline, "Head of Growth");
    assert.equal(body.values.phone, "(512) 555-0147", "a field only the saved resume has is kept");
    assert.deepEqual(body.values.location, { city: "Austin", state: "TX" });
  });

  it("should answer from the browser's text alone when nothing is saved", async () => {
    const { body } = await send("POST", "/profile/contact/suggest", { resumeText: CLEAN });
    assert.equal(body.source, "request");
    assert.equal(body.requestGarbled, false);
    assert.equal(body.values.email, "jordan.rivera@example.com");
  });
});

describe("POST /profile/from-resume with garbled browser text (K5)", () => {
  it("should refuse with a 422 resume_garbled when no clean saved resume exists, and analyze nothing", async () => {
    const { status, body } = await send("POST", "/profile/from-resume", { resumeText: GARBLED });
    assert.equal(status, 422);
    assert.equal(body.reason, "resume_garbled");
    assert.match(body.message, /garbled/);
    assert.equal(existsSync(join(tmpDir, ".jobbored", "resume.txt")), false, "nothing cached");
  });
});
