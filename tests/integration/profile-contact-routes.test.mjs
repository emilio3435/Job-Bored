import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* ============================================================
   "Your details" over HTTP — the real server, HOME redirected.

   POST /profile/contact           replaces the contact half of identity
   POST /profile/contact/suggest   parses a resume, never saves
   POST /profile                   keeps saved details an older editor
                                   leaves out (backcompat)
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 38680 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess;
let tmpDir;
let profilePath;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESUME = `Jordan Rivera
Growth Marketing Leader
Austin, TX | (512) 555-0147 | jordan.rivera@example.com | linkedin.com/in/jordan-rivera
`;

function fitProfile() {
  return {
    version: 1,
    identity: {
      targetRoles: ["Director of Growth"],
      targetSeniority: "director",
      primaryNarrative: "Growth leader who builds AI-assisted marketing systems.",
    },
    strengths: [{ name: "Lifecycle marketing", rank: 1 }],
    hardConstraints: { workMode: "remote_only" },
  };
}

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function saved() {
  return JSON.parse(readFileSync(profilePath, "utf8"));
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jobbored-contact-routes-"));
  profilePath = join(tmpDir, "profile.json");
  serverProcess = spawn(process.execPath, ["index.mjs"], {
    cwd: join(repoRoot, "server"),
    env: {
      ...process.env,
      PORT: String(PORT),
      LISTEN_HOST: "127.0.0.1",
      HOME: tmpDir,
      USERPROFILE: tmpDir,
      JOBBORED_HOME: join(tmpDir, ".jobbored"),
      JOBBORED_PROFILE_PATH: profilePath,
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

describe("POST /profile/contact/suggest", () => {
  it("should return suggestions with confidences from the request's resume text, and save nothing", async () => {
    const { status, body } = await post("/profile/contact/suggest", { resumeText: RESUME });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.source, "request");
    assert.equal(body.suggestions.fullName.value, "Jordan Rivera");
    assert.equal(typeof body.suggestions.email.confidence, "number");
    assert.equal(body.values.email, "jordan.rivera@example.com");
    assert.deepEqual(body.values.location, { city: "Austin", state: "TX" });
    assert.throws(() => readFileSync(profilePath), "suggest never writes a profile");
  });

  it("should answer with empty suggestions when no resume is given or stored", async () => {
    const { status, body } = await post("/profile/contact/suggest", {});
    assert.equal(status, 200);
    assert.equal(body.source, "none");
    assert.equal(body.suggestions.fullName, null);
    assert.deepEqual(body.values, {});
  });
});

describe("POST /profile/contact", () => {
  it("should answer 409 no_profile before the fit profile exists", async () => {
    const { status, body } = await post("/profile/contact", { fullName: "Jordan Rivera" });
    assert.equal(status, 409);
    assert.equal(body.reason, "no_profile");
  });

  it("should save the contact half onto the saved profile, normalized", async () => {
    const created = await post("/profile", fitProfile());
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const { status, body } = await post("/profile/contact", {
      fullName: "Jordan “Jo” Rivera",
      headline: "Growth Marketing Leader",
      email: "jordan.rivera@example.com",
      phone: "(512) 555-0147",
      location: { city: "Austin", state: "TX" },
      links: { linkedin: "linkedin.com/in/jordan-rivera", website: "https://jordanrivera.dev" },
    });
    assert.equal(status, 200, JSON.stringify(body));
    const identity = saved().identity;
    assert.equal(identity.fullName, "Jordan Rivera", "nickname never stored");
    assert.equal(identity.links.linkedin, "https://linkedin.com/in/jordan-rivera");
    assert.deepEqual(identity.targetRoles, ["Director of Growth"], "search intent untouched");
  });

  it("should refuse a bad email with a 400 that names the field", async () => {
    const { status, body } = await post("/profile/contact", { email: "jordan.example.com" });
    assert.equal(status, 400);
    assert.equal(body.reason, "invalid_profile");
    assert.ok(body.errors.some((e) => e.instancePath === "/identity/email"), JSON.stringify(body.errors));
    assert.equal(saved().identity.email, "jordan.rivera@example.com", "the saved file is unchanged");
  });

  it("should keep the details when the fit editor saves identity without them", async () => {
    const edit = fitProfile();
    edit.identity.targetRoles = ["VP Growth"];
    const res = await post("/profile", edit);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const identity = saved().identity;
    assert.deepEqual(identity.targetRoles, ["VP Growth"]);
    assert.equal(identity.fullName, "Jordan Rivera");
    assert.equal(identity.email, "jordan.rivera@example.com");
  });

  it("should clear a field the form sends empty", async () => {
    const { status } = await post("/profile/contact", { fullName: "Jordan Rivera", email: "" });
    assert.equal(status, 200);
    const identity = saved().identity;
    assert.equal(identity.email, undefined);
    assert.equal(identity.links, undefined);
    assert.equal(identity.fullName, "Jordan Rivera");
  });
});
