import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createMaterialsDrafter } from "../../server/materials-drafter.mjs";
import { scriptedMrevFetch as scriptedPipelineFetch } from "../materials-mrev-stub.test.mjs";
import { W3_INTEL, W3_OUTREACH, W3_OUTREACH_TXT } from "../fixtures/materials-w3-package.mjs";

/* ============================================================
   Materials Wave 2 routes over HTTP — the real server, HOME and the
   applications root redirected to a temp dir.

   Packages are drafted first by the real in-process drafter (scripted
   model replies, no PDF browser), so the run folders are the real shape:
     run 1  resume   (Draft both: then the letter)
     run 2  letter   (queued by run 1)
     run 3  resume   in another template family (a fresh cache key)

   GET  /api/applications/:slug/runs
   POST /api/applications/:slug/runs/:runId/promote
   GET  /api/applications/:slug/runs-diff
   GET  /api/applications/:slug/export/resume.docx | cover-letter.docx | linkedin.json
   GET  /api/applications/:slug/files/resume.txt?download=1
   GET  /api/applications/:slug/checklist · PUT (tick one item)
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 38980 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SLUG = "acme-data-platform-engineer";

const USER_RESUME = {
  source: "upload",
  filename: "resume.txt",
  addedAt: "2026-09-26T00:00:00.000Z",
  text: [
    "Jordan Rivera",
    "Austin, TX · jordan.rivera@example.com · 555-010-2030",
    "Northwind — Digital Sales Manager, 2021–2026",
    "- Grew Austin to a top-4 national ranking on a $12M+ book with Google Ads.",
    "- Drove 125% YoY paid-search conversion growth on a flagship account.",
    "Example App — Founder, 2024–present",
    "- Shipped an SEM forecast tool that ran 24+ forecasts against $3.1M of pipeline.",
    "- Built streaming ingestion for analytics events with Kafka and Postgres.",
  ].join("\n"),
};

const JD_TEXT = [
  "Data Platform Engineer at Acme Analytics in Austin, TX. This role builds warehouse",
  "pipelines and streaming ingestion for analytics events, owns observability dashboards,",
  "and partners with analysts on pipeline math and spend reporting.",
  "Requirements: five years with warehouse modeling, streaming ingestion, Python, SQL,",
  "orchestration with Airflow, observability, and cloud platforms. You have shipped",
  "production data systems with clear reliability practices and documentation. The",
  "team values operators who read the source, trace failures to their root cause,",
  "and write plain-language runbooks so on-call rotations stay calm during incidents.",
].join("\n");

let serverProcess;
let tmpDir;
let appsRoot;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    json = null;
  }
  return { status: res.status, body: json, buf, headers: res.headers };
}

/** Read one entry out of a zip (local headers only; deflate or stored). */
function unzipEntry(buf, name) {
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const size = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extra = buf.readUInt16LE(off + 28);
    const entry = buf.subarray(off + 30, off + 30 + nameLen).toString("utf8");
    const start = off + 30 + nameLen + extra;
    const data = buf.subarray(start, start + size);
    if (entry === name) return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    off = start + size;
  }
  return null;
}

async function draftPackages() {
  const pin = { provider: "local", model: "stub", apiKey: "", baseUrl: "http://127.0.0.1:9/v1" };
  const prior = { home: process.env.HOME, profile: process.env.JOBBORED_PROFILE_PATH, jb: process.env.JOBBORED_HOME };
  process.env.HOME = tmpDir;
  process.env.USERPROFILE = tmpDir;
  process.env.JOBBORED_HOME = join(tmpDir, ".jobbored");
  process.env.JOBBORED_PROFILE_PATH = join(tmpDir, ".jobbored", "profile.json");
  try {
    const drafter = createMaterialsDrafter({
      applicationsRoot: appsRoot,
      loadPin: () => pin,
      resolvePin: async (loaded) => ({ ...loaded, resolvedModel: "stub" }),
      scrapeJob: async () => ({ description: JD_TEXT }),
      fetchImpl: scriptedPipelineFetch().fetchImpl,
      openSession: null,
      logoLoader: async () => [],
      targetLogoLoader: async () => null,
      employerLogoLoader: async () => [],
      readSavedResume: async () => null,
    });
    const base = { resume: USER_RESUME, slug: SLUG, company: "Acme Analytics", title: "Data Platform Engineer", jobUrl: "https://example.com/job", notes: "" };
    await drafter.enqueue({ ...base, feature: "resume", then: "cover_letter" });
    await drafter.runUntilIdle();
    await sleep(20);
    await drafter.enqueue({ ...base, feature: "resume", template: "dossier" });
    await drafter.runUntilIdle();
  } finally {
    process.env.HOME = prior.home;
    process.env.USERPROFILE = prior.home;
    for (const [key, value] of [["JOBBORED_PROFILE_PATH", prior.profile], ["JOBBORED_HOME", prior.jb]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jobbored-w2-routes-"));
  appsRoot = join(tmpDir, ".jobbored", "applications");
  await draftPackages();
  serverProcess = spawn(process.execPath, ["index.mjs"], {
    cwd: join(repoRoot, "server"),
    env: {
      ...process.env,
      PORT: String(PORT),
      LISTEN_HOST: "127.0.0.1",
      HOME: tmpDir,
      USERPROFILE: tmpDir,
      JOBBORED_HOME: join(tmpDir, ".jobbored"),
      JOBBORED_APPLICATIONS_ROOT: appsRoot,
      JOBBORED_PROFILE_PATH: join(tmpDir, ".jobbored", "profile.json"),
      BROWSER_USE_DISCOVERY_CONFIG_PATH: join(tmpDir, "worker-config.json"),
      HERMES_RESUME_TEMPLATE_DIR: join(tmpDir, "resume-template"),
      HERMES_APPLICATIONS_LEGACY_ROOT: join(tmpDir, "no-legacy"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 60; i += 1) {
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

describe("GET /api/applications/:slug/runs", () => {
  it("should list every run newest first with template, verdicts and what is in use", async () => {
    const { status, body } = await call("GET", `/api/applications/${SLUG}/runs`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.runs.length, 3);
    const [newest, letter, oldest] = body.runs;
    assert.deepEqual(newest.documents, ["resume"]);
    assert.equal(newest.template, "dossier");
    assert.deepEqual(newest.active, ["resume"], "the latest resume is the one served");
    assert.deepEqual(letter.documents, ["cover_letter"]);
    assert.deepEqual(letter.active, ["cover_letter"]);
    assert.deepEqual(oldest.active, [], "the first resume was replaced");
    for (const run of body.runs) {
      assert.match(run.runId, /^mr_/);
      assert.ok(Date.parse(run.date), run.date);
      for (const doc of run.documents) assert.match(run.verdicts[doc].disposition, /^(READY|REVIEW|FAIL)$/);
    }
  });

  it("should answer 404 for an unknown application", async () => {
    const { status } = await call("GET", "/api/applications/no-such-role/runs");
    assert.equal(status, 404);
  });
});

describe("GET /api/applications/:slug/runs-diff", () => {
  it("should diff two runs' resume.txt line by line", async () => {
    const { body: list } = await call("GET", `/api/applications/${SLUG}/runs`);
    const resumes = list.runs.filter((r) => r.documents.includes("resume"));
    const { status, body } = await call("GET", `/api/applications/${SLUG}/runs-diff?a=${resumes[1].runId}&b=${resumes[0].runId}&doc=resume`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.doc, "resume");
    assert.ok(Array.isArray(body.lines) && body.lines.length > 0);
    for (const line of body.lines) assert.match(line.op, /^(same|add|del)$/);
    assert.equal(body.added, body.lines.filter((l) => l.op === "add").length);
    assert.ok(body.lines.some((l) => l.op === "same" && /Jordan Rivera/.test(l.text)), "the name line is shared");
    const aliased = await call("GET", `/api/applications/${SLUG}/runs-diff?from=${resumes[1].runId}&to=${resumes[0].runId}&doc=resume`);
    assert.equal(aliased.status, 200);
    assert.deepEqual(aliased.body, body, "from/to are aliases for a/b");
  });

  it("should refuse a run id that tries to leave the runs folder", async () => {
    const { status, body } = await call("GET", `/api/applications/${SLUG}/runs-diff?a=..%2F..&b=x&doc=resume`);
    assert.equal(status, 400, JSON.stringify(body));
  });

  it("should refuse an unknown document", async () => {
    const { body: list } = await call("GET", `/api/applications/${SLUG}/runs`);
    const id = list.runs[0].runId;
    const { status, body } = await call("GET", `/api/applications/${SLUG}/runs-diff?a=${id}&b=${id}&doc=portfolio`);
    assert.equal(status, 400);
    assert.equal(body.code, "invalid_doc");
  });
});

describe("POST /api/applications/:slug/repair", () => {
  it("C2 and G3: returns 409 before enqueue when the run lacks its per-document draft", async () => {
    const runsDir = join(appsRoot, SLUG, "runs");
    const before = readdirSync(runsDir);
    const { body: listing } = await call("GET", `/api/applications/${SLUG}/runs`);
    const latestResume = listing.runs.find((run) => run.documents.includes("resume"));
    const draftPath = join(runsDir, latestResume.runId, "draft.resume.json");
    const originalDraft = readFileSync(draftPath);
    try {
      writeFileSync(draftPath, "{}");
      const result = await call("POST", `/api/applications/${SLUG}/repair`, {
        feature: "resume", instruction: "Tighten the summary", jobUrl: "https://example.com/job",
      });
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.equal(result.body.code, "repair_source_missing");
      assert.deepEqual(readdirSync(runsDir), before);
      assert.equal(existsSync(join(appsRoot, SLUG, "pending.json")), false);
    } finally {
      writeFileSync(draftPath, originalDraft);
    }
  });
});

describe("POST /api/applications/:slug/runs/:runId/promote", () => {
  it("should serve an older resume again and leave the letter alone", async () => {
    const { body: list } = await call("GET", `/api/applications/${SLUG}/runs`);
    const oldest = list.runs[list.runs.length - 1];
    const letterBefore = readFileSync(join(appsRoot, SLUG, "cover-letter.txt"), "utf8");
    const { status, body } = await call("POST", `/api/applications/${SLUG}/runs/${oldest.runId}/promote`, {});
    assert.equal(status, 200, JSON.stringify(body));
    assert.deepEqual(body.documents, ["resume"]);
    assert.equal(
      readFileSync(join(appsRoot, SLUG, "resume.txt"), "utf8"),
      readFileSync(join(appsRoot, SLUG, "runs", oldest.runId, "resume.txt"), "utf8"),
    );
    assert.equal(readFileSync(join(appsRoot, SLUG, "cover-letter.txt"), "utf8"), letterBefore);
    const manifest = JSON.parse(readFileSync(join(appsRoot, SLUG, "manifest.json"), "utf8"));
    assert.equal(manifest.runId, oldest.runId);
    const { body: after } = await call("GET", `/api/applications/${SLUG}/runs`);
    assert.deepEqual(after.runs.find((r) => r.runId === oldest.runId).active, ["resume"]);
    assert.deepEqual(after.runs[0].active, [], "the newer resume is no longer the one in use");
  });

  it("should answer 404 for a run that does not exist", async () => {
    const { status, body } = await call("POST", `/api/applications/${SLUG}/runs/mr_nope/promote`, {});
    assert.equal(status, 404);
    assert.equal(body.code, "run_not_found");
  });
});

describe("GET /api/applications/:slug/export/*", () => {
  it("should build a Word resume from the render model", async () => {
    const { status, buf, headers } = await call("GET", `/api/applications/${SLUG}/export/resume.docx?download=1`);
    assert.equal(status, 200);
    assert.match(headers.get("content-type"), /wordprocessingml\.document/);
    assert.match(headers.get("content-disposition"), /attachment; filename="resume\.docx"/);
    assert.equal(buf.readUInt32LE(0), 0x04034b50, "a zip");
    const types = unzipEntry(buf, "[Content_Types].xml");
    assert.match(types, /wordprocessingml\.document\.main\+xml/);
    const doc = unzipEntry(buf, "word/document.xml");
    assert.match(doc, /<w:document /);
    assert.match(doc, /Jordan Rivera/);
    /* Same words as the ATS twin: every bullet line of resume.txt appears. */
    const txt = readFileSync(join(appsRoot, SLUG, "resume.txt"), "utf8");
    const firstBullet = txt.split("\n").find((l) => /^- /.test(l));
    if (firstBullet) assert.ok(doc.includes(firstBullet.slice(2, 30).replace(/&/g, "&amp;")), firstBullet);
  });

  it("should build a Word cover letter", async () => {
    const { status, buf } = await call("GET", `/api/applications/${SLUG}/export/cover-letter.docx`);
    assert.equal(status, 200);
    assert.match(unzipEntry(buf, "word/document.xml"), /Jordan Rivera/);
  });

  it("should give LinkedIn's About and Experience as text", async () => {
    const { status, body } = await call("GET", `/api/applications/${SLUG}/export/linkedin.json`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(typeof body.about, "string");
    assert.match(body.text, /^ABOUT\n/);
    assert.match(body.text, /\nEXPERIENCE\n/);
  });

  it("should refuse an export it does not know", async () => {
    const { status, body } = await call("GET", `/api/applications/${SLUG}/export/resume.exe`);
    assert.equal(status, 400);
    assert.equal(body.code, "unknown_export");
  });
});

describe("ATS plain text downloads", () => {
  it("should serve resume.txt as an attachment", async () => {
    const { status, buf, headers } = await call("GET", `/api/applications/${SLUG}/files/resume.txt?download=1`);
    assert.equal(status, 200);
    assert.match(headers.get("content-type"), /text\/plain/);
    assert.match(headers.get("content-disposition"), /attachment; filename="resume\.txt"/);
    assert.match(buf.toString("utf8"), /Jordan Rivera/);
  });

  it("should expose the text twin and exports on the manifest's documents", async () => {
    const { body } = await call("GET", `/api/applications/${SLUG}/manifest`);
    const resume = body.documents.find((d) => d.type === "resume");
    assert.equal(resume.text.filename, "resume.txt");
    assert.deepEqual(resume.exports, { docx: true, linkedin: true });
    const letter = body.documents.find((d) => d.type === "cover_letter");
    assert.equal(letter.text.filename, "cover-letter.txt");
    assert.deepEqual(letter.exports, { docx: true, linkedin: false });
    assert.ok(!resume.files.some((f) => f.filename === "resume.txt"), "the twin is not counted as a card file");
    assert.ok(readdirSync(join(appsRoot, SLUG, "runs")).length === 3);
  });
});

describe("GET / PUT /api/applications/:slug/checklist", () => {
  it("should build the checklist from the package and store it in the application folder", async () => {
    const { status, body } = await call("GET", `/api/applications/${SLUG}/checklist?contact=Dana%20Reyes`);
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.contract, "materials.checklist.v1");
    assert.equal(body.progress.done, 0);
    const byId = Object.fromEntries(body.items.map((i) => [i.id, i]));
    assert.equal(byId.resume.action.filename, "resume.pdf");
    assert.equal(byId.letter.action.kind, "preview");
    assert.equal(byId.submit.action.href, "https://example.com/job");
    assert.equal(byId.outreach.label, "Send a short note to Dana Reyes");
    const stored = JSON.parse(readFileSync(join(appsRoot, SLUG, "checklist.json"), "utf8"));
    assert.equal(stored.items.length, body.items.length);
  });

  it("should persist a tick, report progress, and keep it on the next GET", async () => {
    const put = await call("PUT", `/api/applications/${SLUG}/checklist`, { id: "confirmation", done: true });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.progress.done, 1);
    const item = put.body.items.find((i) => i.id === "confirmation");
    assert.equal(item.done, true);
    assert.ok(Date.parse(item.doneAt));
    const again = await call("GET", `/api/applications/${SLUG}/checklist`);
    assert.equal(again.body.items.find((i) => i.id === "confirmation").done, true);
    const stored = JSON.parse(readFileSync(join(appsRoot, SLUG, "checklist.json"), "utf8"));
    assert.equal(stored.items.find((i) => i.id === "confirmation").done, true);
  });

  it("should refuse an unknown item with a 400", async () => {
    const { status, body } = await call("PUT", `/api/applications/${SLUG}/checklist`, { id: "hack", done: true });
    assert.equal(status, 400);
    assert.equal(body.code, "unknown_item");
  });
});

describe("Wave 3 package files (staged fixture)", () => {
  it("should serve outreach.json, outreach.txt and intel.json from the package", async () => {
    const dir = join(appsRoot, SLUG);
    writeFileSync(join(dir, "outreach.json"), JSON.stringify(W3_OUTREACH));
    writeFileSync(join(dir, "outreach.txt"), W3_OUTREACH_TXT);
    writeFileSync(join(dir, "intel.json"), JSON.stringify(W3_INTEL));
    const out = await call("GET", `/api/applications/${SLUG}/files/outreach.json`);
    assert.equal(out.status, 200);
    assert.equal(out.body.linkedin.text, W3_OUTREACH.linkedin.text);
    const txt = await call("GET", `/api/applications/${SLUG}/files/outreach.txt?download=1`);
    assert.equal(txt.status, 200);
    assert.match(txt.headers.get("content-disposition"), /outreach\.txt/);
    const intel = await call("GET", `/api/applications/${SLUG}/files/intel.json`);
    assert.equal(intel.status, 200);
    assert.equal(intel.body.contract, "materials.intel.v1");
  });

  it("should offer the outreach note as the checklist's copy action", async () => {
    const { body } = await call("GET", `/api/applications/${SLUG}/checklist`);
    const outreach = body.items.find((i) => i.id === "outreach");
    assert.equal(outreach.action.kind, "copy");
    assert.equal(outreach.action.text, W3_OUTREACH.linkedin.text);
  });
});
