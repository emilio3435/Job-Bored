import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* ============================================================
   "Your voice" over HTTP — the real server, HOME redirected.

   GET    /profile/voice   the saved guide + word count
   PUT    /profile/voice   atomic save, backup of the previous guide,
                           64 KB cap, empty/binary refused, stale
                           `ifUpdatedAt` refused
   DELETE /profile/voice   moves the guide to a backup
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 38780 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let serverProcess;
let tmpDir;
let profileDir;
let voicePath;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GUIDE = `# Voice guide — Jordan Rivera

## Voice summary
Plain, specific, a little dry. I sell with numbers and short stories.

## Approved facts
- Grew trial-to-paid conversion 38% in two quarters
- Ran lifecycle for 200+ locations

## Cover letter rules
Three short paragraphs. Open with the work, never with flattery.
`;

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json, headers: res.headers };
}

function backups() {
  if (!existsSync(profileDir)) return [];
  return readdirSync(profileDir)
    .filter((name) => name.startsWith("voice.md.bak."))
    .sort();
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jobbored-voice-routes-"));
  profileDir = join(tmpDir, ".jobbored", "profile");
  voicePath = join(profileDir, "voice.md");
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

describe("GET /profile/voice", () => {
  it("should say there is no guide yet on a fresh install", async () => {
    const { status, body } = await call("GET", "/profile/voice");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.exists, false);
    assert.equal(body.text, "");
    assert.equal(body.updatedAt, null);
    assert.equal(body.words, 0);
  });
});

describe("PUT /profile/voice", () => {
  it("should refuse an empty guide with a 400 and write nothing", async () => {
    for (const text of ["", "   \n\t  "]) {
      const { status, body } = await call("PUT", "/profile/voice", { text });
      assert.equal(status, 400, JSON.stringify(body));
      assert.equal(body.reason, "empty");
    }
    assert.equal(existsSync(voicePath), false);
  });

  it("should refuse a body without text", async () => {
    const { status, body } = await call("PUT", "/profile/voice", { markdown: GUIDE });
    assert.equal(status, 400);
    assert.equal(body.reason, "invalid_body");
    assert.equal(existsSync(voicePath), false);
  });

  it("should refuse binary content", async () => {
    const { status, body } = await call("PUT", "/profile/voice", { text: `PK\u0003\u0004\u0000\u0000binary` });
    assert.equal(status, 400);
    assert.equal(body.reason, "binary");
    assert.equal(existsSync(voicePath), false);
  });

  it("should refuse a guide over 64 KB with a 413", async () => {
    const text = `# Voice guide\n\n${"word ".repeat(14000)}`;
    assert.ok(Buffer.byteLength(text) > 64 * 1024);
    const { status, body } = await call("PUT", "/profile/voice", { text });
    assert.equal(status, 413);
    assert.equal(body.reason, "too_large");
    assert.equal(body.maxBytes, 65536);
    assert.equal(existsSync(voicePath), false);
  });

  it("should save the guide where the materials pipeline reads it, and read it back", async () => {
    const { status, body } = await call("PUT", "/profile/voice", { text: GUIDE, ifUpdatedAt: null });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.backup, null, "nothing to back up the first time");
    assert.ok(body.words > 20);
    // ~/.jobbored/profile/voice.md — server/materials-pipeline.mjs readVoiceOverride.
    assert.equal(readFileSync(voicePath, "utf8"), GUIDE);
    assert.deepEqual(backups(), []);
    assert.deepEqual(
      readdirSync(profileDir).filter((n) => n.includes(".tmp.")),
      [],
      "no temp file left behind",
    );

    const read = await call("GET", "/profile/voice");
    assert.equal(read.body.exists, true);
    assert.equal(read.body.text, GUIDE);
    assert.equal(read.body.words, body.words);
    assert.equal(read.body.updatedAt, body.updatedAt);
    assert.ok(!Number.isNaN(Date.parse(read.body.updatedAt)));
  });

  it("should normalize line endings and unwrap a guide pasted inside a ```markdown fence", async () => {
    const before = backups().length;
    const current = await call("GET", "/profile/voice");
    const pasted = "```markdown\r\n" + GUIDE.replace(/\n/g, "\r\n") + "```\r\n";
    const { status, body } = await call("PUT", "/profile/voice", {
      text: pasted,
      ifUpdatedAt: current.body.updatedAt,
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.unchanged, true, "the same guide is not rewritten or backed up");
    assert.equal(readFileSync(voicePath, "utf8"), GUIDE);
    assert.equal(backups().length, before);
  });

  it("should keep a timestamped backup of the previous guide when replacing it", async () => {
    const current = await call("GET", "/profile/voice");
    const next = GUIDE.replace("a little dry", "warm but exact");
    const { status, body } = await call("PUT", "/profile/voice", {
      text: next,
      ifUpdatedAt: current.body.updatedAt,
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.match(body.backup, /^voice\.md\.bak\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z(-\d+)?$/);
    assert.equal(body.backup.includes(":"), false, "backup names are safe on Windows");
    assert.equal(readFileSync(voicePath, "utf8"), next);
    assert.equal(readFileSync(join(profileDir, body.backup), "utf8"), GUIDE, "the old guide survives");
  });

  it("should refuse a stale save with a 409 instead of silently overwriting", async () => {
    const before = readFileSync(voicePath, "utf8");
    const stale = await call("PUT", "/profile/voice", {
      text: "# Something else\n\nA different guide.",
      ifUpdatedAt: "2020-01-01T00:00:00.000Z",
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.reason, "changed");
    assert.equal(typeof stale.body.updatedAt, "string");
    const fresh = await call("PUT", "/profile/voice", { text: "# Brand new\n\nHi.", ifUpdatedAt: null });
    assert.equal(fresh.status, 409, "a caller that saw no guide cannot overwrite one");
    assert.equal(readFileSync(voicePath, "utf8"), before);
  });
});

describe("DELETE /profile/voice", () => {
  it("should move the guide to a backup, never delete it", async () => {
    const before = readFileSync(voicePath, "utf8");
    const count = backups().length;
    const { status, body } = await call("DELETE", "/profile/voice");
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.exists, false);
    assert.equal(existsSync(voicePath), false);
    assert.equal(backups().length, count + 1);
    assert.equal(readFileSync(join(profileDir, body.backup), "utf8"), before);

    const read = await call("GET", "/profile/voice");
    assert.equal(read.body.exists, false);
  });

  it("should answer 404 when there is no guide to remove", async () => {
    const { status, body } = await call("DELETE", "/profile/voice");
    assert.equal(status, 404);
    assert.equal(body.reason, "not_found");
  });
});

describe("/profile/voice origin protection", () => {
  it("should refuse a request from a foreign page", async () => {
    const { status } = await call("PUT", "/profile/voice", { text: GUIDE }, { origin: "https://evil.example" });
    assert.equal(status, 403);
    assert.equal(existsSync(voicePath), false);
  });

  it("should let the local dashboard preflight a DELETE", async () => {
    const res = await fetch(`${BASE_URL}/profile/voice`, {
      method: "OPTIONS",
      headers: {
        origin: BASE_URL,
        "access-control-request-method": "DELETE",
      },
    });
    assert.equal(res.status, 204);
    assert.match(String(res.headers.get("access-control-allow-methods")), /DELETE/);
  });
});
