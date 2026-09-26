/**
 * UX01 C11 (server half): draft from the user's resume, or not at all.
 *
 * Covers TA-01 (drafts were written from the maintainer's committed
 * resume-template/resume.html) and the request contract lane E consumes:
 *   body.resume = { source, filename, addedAt, text }
 *   missing/empty → 422 { error: "Add your resume before drafting.", code: "resume_required" }
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeRequestBody,
  spawnMaterialsRequest,
} from "../server/materials-request.mjs";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { buildRepairRequestPayload } from "../server/materials-repair.mjs";
import { critiqueMaterials } from "../server/materials-critic.mjs";
import {
  RESUME_REQUIRED_CODE,
  RESUME_REQUIRED_MESSAGE,
  normalizeResumeSource,
  readResumeSnapshot,
} from "../server/materials-resume-source.mjs";

const USER_RESUME_TEXT = [
  "Jordan Rivera",
  "Austin, TX · jordan@example.com",
  "",
  "EXPERIENCE",
  "Northwind Logistics — Operations Analyst, 2021–2025",
  "- Cut late shipments 18% by rebuilding the carrier scorecard.",
  "",
  "EDUCATION",
  "B.S. Industrial Engineering, Example State University",
].join("\n");

const validBody = {
  slug: "acme-ops-analyst",
  company: "Acme",
  title: "Ops Analyst",
  feature: "both",
  jobUrl: "https://example.com/jobs/1",
  notes: "",
  resume: {
    source: "portfolio",
    filename: "jordan-rivera.pdf",
    addedAt: "2026-09-20T15:00:00.000Z",
    text: USER_RESUME_TEXT,
  },
};

/** @param {unknown} err */
function isResumeRequired(err) {
  const e = /** @type {{ statusCode?: number, code?: string, message?: string }} */ (err);
  return (
    e.statusCode === 422 &&
    e.code === "resume_required" &&
    e.message === "Add your resume before drafting."
  );
}

describe("C11 request contract: resume required", () => {
  it("exports the 422 code and message lane E renders", () => {
    assert.equal(RESUME_REQUIRED_CODE, "resume_required");
    assert.equal(RESUME_REQUIRED_MESSAGE, "Add your resume before drafting.");
  });

  it("should respond 422 resume_required when the body has no resume", () => {
    const { resume: _omit, ...noResume } = validBody;
    assert.throws(() => normalizeRequestBody(noResume), isResumeRequired);
  });

  it("should respond 422 resume_required when the resume text is blank", () => {
    assert.throws(
      () => normalizeRequestBody({ ...validBody, resume: { ...validBody.resume, text: "   \n " } }),
      isResumeRequired,
    );
    assert.throws(
      () => normalizeRequestBody({ ...validBody, resume: "just a string" }),
      isResumeRequired,
    );
  });

  it("should carry the normalized resume through when it is present", () => {
    const out = normalizeRequestBody(validBody);
    assert.deepEqual(out.resume, validBody.resume);
  });

  it("normalizes a partial resume source with safe defaults", () => {
    const out = normalizeResumeSource({ text: "  Jordan Rivera\r\nAnalyst  " });
    assert.ok(out);
    assert.equal(out.text, "Jordan Rivera\nAnalyst");
    assert.equal(out.source, "unknown");
    assert.equal(out.filename, "");
    assert.equal(out.addedAt, "");
  });

  it("still validates slug before resume so 400s stay 400s", () => {
    assert.throws(
      () => normalizeRequestBody({ ...validBody, slug: "../x", resume: undefined }),
      (e) => e.statusCode === 400,
    );
  });
});

describe("C11 repair path redrafts from the resume snapshot", () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jb-c11-snap-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("marks repair payloads as snapshot-backed", () => {
    const { payload } = buildRepairRequestPayload({
      slug: "acme-ops-analyst",
      company: "Acme",
      title: "Ops Analyst",
      quality: { documents: { resume: { issues: [{ code: "keyword_coverage_low", message: "thin" }] } } },
    }, { feature: "resume" });
    assert.equal(payload.resumeFrom, "snapshot");
    const normalized = normalizeRequestBody(payload);
    assert.equal(normalized.resume, null);
    assert.equal(normalized.resumeFrom, "snapshot");
  });

  it("should 422 a snapshot-backed request when no snapshot exists", async () => {
    const payload = normalizeRequestBody({ ...validBody, resume: undefined, resumeFrom: "snapshot" });
    await assert.rejects(
      () => spawnMaterialsRequest(payload, { applicationsRoot: root, enqueue: async () => ({ ok: true }) }),
      isResumeRequired,
    );
  });

  it("should load the slug's snapshot for a snapshot-backed request", async () => {
    await mkdir(join(root, "acme-ops-analyst"), { recursive: true });
    await writeFile(
      join(root, "acme-ops-analyst", "resume-source.json"),
      JSON.stringify({ ...validBody.resume, usedAt: "2026-09-21T00:00:00.000Z" }),
    );
    const payload = normalizeRequestBody({ ...validBody, resume: undefined, resumeFrom: "snapshot" });
    let seen = null;
    await spawnMaterialsRequest(payload, {
      applicationsRoot: root,
      enqueue: async (p) => {
        seen = p;
        return { ok: true };
      },
    });
    assert.equal(seen.resume.text, USER_RESUME_TEXT);
    assert.equal(seen.resume.filename, "jordan-rivera.pdf");
  });
});

const letterJson = {
  hook: "I rebuild carrier scorecards until shipments land on time.",
  whyThem: "Acme runs the network I have spent four years tuning.",
  whyMe: "At Northwind I cut late shipments 18%.",
  whyNow: "I want to bring that to Acme's growth year.",
  closing: "Happy to walk through the scorecard.",
  company: "Acme",
  role: "Ops Analyst",
};
const resumeJson = {
  header: { name: "Jordan Rivera", headline: "Operations analyst", contact: ["Austin, TX", "jordan@example.com"] },
  summary: { opener: "Operations analyst.", body: "Carrier performance and network planning." },
  roles: [
    {
      id: "northwind",
      company: "Northwind Logistics",
      title: "Operations Analyst",
      dates: "2021–2025",
      bullets: ["Cut late shipments 18% by rebuilding the carrier scorecard."],
    },
  ],
  education: ["B.S. Industrial Engineering, Example State University"],
  skills: ["SQL", "Carrier analytics"],
};

describe("C11 drafter drafts from the user's resume", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-c11-draft-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function productionDeps(extra = {}) {
    return {
      applicationsRoot: dir,
      loadPin: () => ({ provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "" }),
      resolvePin: async (pin) => ({ ...pin, resolvedModel: "gemini-flash" }),
      scrapeJob: async () => ({ description: "carrier network operations analyst scorecard ".repeat(40) }),
      critic: async () => ({ status: "pass", issues: [] }),
      pdfRenderer: async () => ({ skipped: true, note: "pdf_skipped" }),
      /* Hermetic: never read the host's resolved brand logos. */
      logoLoader: async () => [],
      now: () => new Date("2026-09-25T12:00:00.000Z"),
      ...extra,
    };
  }

  it("should refuse to enqueue without a resume and write no pending.json", async () => {
    const drafter = createMaterialsDrafter(productionDeps({ writer: async () => ({}) }));
    const { resume: _omit, ...noResume } = validBody;
    await assert.rejects(() => drafter.enqueue(noResume), isResumeRequired);
    await assert.rejects(readFile(join(dir, "acme-ops-analyst", "pending.json")));
  });

  it("should send the user's resume text to the writer, never the repo template", async () => {
    /** @type {Record<string, unknown> | null} */
    let writerInput = null;
    const drafter = createMaterialsDrafter(productionDeps({
      writer: async (input) => {
        writerInput = input;
        return { letter: letterJson, resume: resumeJson };
      },
    }));
    await drafter.enqueue(normalizeRequestBody(validBody));
    await drafter.runUntilIdle();

    assert.ok(writerInput, "writer should run");
    assert.equal(writerInput.resumeText, USER_RESUME_TEXT);
    assert.doesNotMatch(String(writerInput.masterResumeHtml || ""), /Emilio|Audacy/);

    const resumeHtml = await readFile(join(dir, "acme-ops-analyst", "resume.html"), "utf8");
    const letterHtml = await readFile(join(dir, "acme-ops-analyst", "cover-letter.html"), "utf8");
    for (const html of [resumeHtml, letterHtml]) {
      assert.doesNotMatch(html, /Emilio|Nunez|Audacy|emiliobuilds/i);
      assert.match(html, /Jordan Rivera/);
    }
    assert.match(resumeHtml, /Northwind Logistics/);
    assert.match(resumeHtml, /data-section="summary"/);
    assert.match(resumeHtml, /data-section="experience"/);
    assert.match(letterHtml, /Acme/);
  });

  it("should record provenance: snapshot on disk, pending.json and the QA report", async () => {
    let pendingSeen = null;
    const drafter = createMaterialsDrafter(productionDeps({
      writer: async () => {
        pendingSeen = JSON.parse(await readFile(join(dir, "acme-ops-analyst", "pending.json"), "utf8"));
        return { letter: letterJson, resume: resumeJson };
      },
    }));
    await drafter.enqueue(normalizeRequestBody(validBody));
    await drafter.runUntilIdle();

    assert.deepEqual(pendingSeen.resume, {
      source: "portfolio",
      filename: "jordan-rivera.pdf",
      addedAt: "2026-09-20T15:00:00.000Z",
    });
    const snap = await readResumeSnapshot(join(dir, "acme-ops-analyst"));
    assert.equal(snap.text, USER_RESUME_TEXT);
    assert.equal(snap.usedAt, "2026-09-25T12:00:00.000Z");
    const report = await readFile(join(dir, "acme-ops-analyst", "qa-report.md"), "utf8");
    assert.match(report, /Drafted from: jordan-rivera\.pdf \(portfolio, added 2026-09-20\)/);
  });
});

describe("C11 critic: no invented employers", () => {
  it("should fail a resume naming an employer absent from the user's resume", async () => {
    const card = await critiqueMaterials({
      letterHtml: "<p>hi</p>",
      resumeHtml: '<h2 class="company-name">Globex Corp</h2><h2 class="company-name">Northwind Logistics</h2>',
      jdText: "",
      sourceResumeText: USER_RESUME_TEXT,
      writerJson: {},
    });
    const invented = card.issues.find((i) => i.code === "invented_employer");
    assert.ok(invented, "invented_employer issue expected");
    assert.equal(invented.severity, "fail");
    assert.match(invented.message, /Globex Corp/);
    assert.doesNotMatch(invented.message, /Northwind/);
  });
});
