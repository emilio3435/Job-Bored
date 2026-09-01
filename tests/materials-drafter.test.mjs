import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";

const letterTpl = `<html><head><style>.x{}</style></head><body><p data-slot="hook">old</p><p data-slot="why-them"></p><p data-slot="why-me"></p><p data-slot="why-now"></p><p data-slot="closing"></p></body></html>`;
const resumeTpl = `<html><head><style>.x{}</style></head><body><section data-section="summary">s</section><article data-role="audacy-dsm"><ul><li>b</li></ul></article><section data-section="experience">e</section></body></html>`;

const goodJson = {
  letter: {
    hook: "I ship paid spend toward marginal ROAS for advancement teams.",
    whyThem: "EAB already owns the university relationships I have spent a decade earning.",
    whyMe: "At Audacy I ran a 10M digital P and L and took Denver to a top-3 national rank.",
    whyNow: "I want to point that operator-builder mix at alumni growth.",
    closing: "Happy to walk through the forecast stack.",
    company: "EAB",
    role: "Senior Director",
  },
  resume: {
    summary: { opener: "Operator.", body: "Paid media plus AI systems." },
    roles: [{ id: "audacy-dsm", bullets: ["Grew Denver to top-3 nationally on a 10M book."] }],
  },
};

const pin = {
  provider: "gemini",
  model: "gemini-3.7-flash",
  apiKey: "k",
  baseUrl: "",
};

function baseDeps(dir, extra = {}) {
  return {
    applicationsRoot: dir,
    loadPin: () => pin,
    resolvePin: async (loaded) => ({ ...loaded, resolvedModel: "gemini-3.7-flash" }),
    scrapeJob: async () => ({ description: "digital marketing strategy advancement ".repeat(40) }),
    readMasterLetter: async () => letterTpl,
    readMasterResume: async () => resumeTpl,
    writer: async () => goodJson,
    editor: async () => goodJson,
    critic: async () => ({ status: "pass", issues: [] }),
    pdfRenderer: async () => ({ skipped: true, note: "pdf_skipped" }),
    ...extra,
  };
}

describe("createMaterialsDrafter", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-draft-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("409s without a pin and does not write pending", async () => {
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => null,
    });
    await assert.rejects(
      () =>
        drafter.enqueue({
          slug: "eab-role",
          company: "EAB",
          title: "Director",
          feature: "both",
          jobUrl: "https://example.com/job",
          notes: "",
        }),
      (err) => err.statusCode === 409 && err.code === "llm_unconfigured",
    );
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
  });

  it("writes REVIEW with jd_unusable when scrape fails on a blurb", async () => {
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => ({ provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "" }),
      resolvePin: async (pin) => ({ ...pin, resolvedModel: "gemini-3.7-flash" }),
      scrapeJob: async () => {
        throw new Error("nope");
      },
      readMasterLetter: async () => letterTpl,
      readMasterResume: async () => resumeTpl,
    });
    await mkdir(join(dir, "eab-role"), { recursive: true });
    await writeFile(join(dir, "eab-role", "job-description.md"), "Low fit — 4.7/10");
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /jd_unusable/);
    const pending = JSON.parse(await readFile(join(dir, "eab-role", "pending.json"), "utf8"));
    assert.equal(pending.progress.phase, "failed");
    await assert.rejects(readFile(join(dir, "eab-role", "resume.html")));
    await assert.rejects(readFile(join(dir, "eab-role", "cover-letter.html")));
  });

  it("loops the editor once then READY when the second critic passes", async () => {
    let writerCalls = 0;
    let editorCalls = 0;
    let criticCalls = 0;
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => ({ provider: "gemini", model: "gemini-3.7-flash", apiKey: "k", baseUrl: "" }),
      resolvePin: async (pin) => ({ ...pin, resolvedModel: "gemini-3.7-flash" }),
      scrapeJob: async () => ({ description: "digital marketing strategy advancement ".repeat(40) }),
      readMasterLetter: async () => letterTpl,
      readMasterResume: async () => resumeTpl,
      writer: async () => {
        writerCalls += 1;
        return goodJson;
      },
      editor: async () => {
        editorCalls += 1;
        return goodJson;
      },
      critic: async () => {
        criticCalls += 1;
        if (criticCalls === 1) {
          return { status: "review", issues: [{ code: "keyword_coverage_low", message: "thin", severity: "review" }] };
        }
        return { status: "pass", issues: [] };
      },
      pdfRenderer: async () => ({ skipped: true }),
    });
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    assert.equal(writerCalls, 1);
    assert.equal(editorCalls, 1);
    const html = await readFile(join(dir, "eab-role", "cover-letter.html"), "utf8");
    assert.match(html, /EAB|hook|marginal ROAS|advancement/i);
  });

  it("stops after two editor loops at REVIEW, never READY", async () => {
    let editorCalls = 0;
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => ({ provider: "gemini", model: "gemini-3.7-flash", apiKey: "k", baseUrl: "" }),
      resolvePin: async (pin) => ({ ...pin, resolvedModel: "gemini-3.7-flash" }),
      scrapeJob: async () => ({ description: "digital marketing strategy advancement ".repeat(40) }),
      readMasterLetter: async () => letterTpl,
      readMasterResume: async () => resumeTpl,
      writer: async () => goodJson,
      editor: async () => {
        editorCalls += 1;
        return goodJson;
      },
      critic: async () => ({ status: "fail", issues: [{ code: "banned_filler", message: "x", severity: "fail" }] }),
      pdfRenderer: async () => ({ skipped: true }),
    });
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    assert.equal(editorCalls, 2);
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /banned_filler|REVIEW|review/i);
  });

  it("returns accepted pending fields and deletes pending.json on READY", async () => {
    const drafter = createMaterialsDrafter(baseDeps(dir));
    const result = await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    assert.equal(result.ok, true);
    assert.equal(result.accepted, true);
    assert.equal(result.slug, "eab-role");
    assert.equal(result.pending_path, join(dir, "eab-role", "pending.json"));
    assert.equal(typeof result.requested_at, "string");
    await drafter.runUntilIdle();
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /READY|pass/i);
  });

  it("returns the existing pending for the same in-flight slug", async () => {
    let writerCalls = 0;
    let releaseWriter;
    const hold = new Promise((resolve) => {
      releaseWriter = resolve;
    });
    const drafter = createMaterialsDrafter(
      baseDeps(dir, {
        writer: async () => {
          writerCalls += 1;
          await hold;
          return goodJson;
        },
      }),
    );
    const first = await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "first",
    });
    const second = await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "second should not start",
    });
    assert.equal(second.pending_path, first.pending_path);
    assert.equal(second.requested_at, first.requested_at);
    assert.ok(writerCalls <= 1, "duplicate enqueue must not start a second writer");
    releaseWriter();
    await drafter.runUntilIdle();
    assert.equal(writerCalls, 1);
  });

  it("keeps failed pending.json when the writer crashes", async () => {
    const drafter = createMaterialsDrafter(
      baseDeps(dir, {
        writer: async () => {
          throw new Error("gemini down");
        },
      }),
    );
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    const pending = JSON.parse(await readFile(join(dir, "eab-role", "pending.json"), "utf8"));
    assert.equal(pending.progress.phase, "failed");
  });

  it("fills nested letter chrome slots and keeps .dot children", async () => {
    const nestedLetter = `<html><head><style>.x{}</style></head><body>
      <p data-slot="hook">old <span data-slot="company-mention">[Company]</span></p>
      <p data-slot="why-them"><span data-slot="company-mention-2">[Company]</span> and <strong data-slot="role-keyword">[role]</strong></p>
      <p data-slot="why-me"></p>
      <p data-slot="why-now"><span data-slot="company-mention-3">[Company]</span></p>
      <p data-slot="closing">see <em data-slot="closing-hook">[hook]</em></p>
      <p data-slot="flourish">line<span class="dot"></span></p>
    </body></html>`;
    const drafter = createMaterialsDrafter(
      baseDeps(dir, {
        readMasterLetter: async () => nestedLetter,
      }),
    );
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    const html = await readFile(join(dir, "eab-role", "cover-letter.html"), "utf8");
    assert.match(html, /marginal ROAS/);
    assert.match(html, /university relationships/);
    assert.match(html, /operator-builder mix/);
    assert.match(html, /forecast stack/);
    assert.match(html, /data-slot="company-mention"[^>]*>EAB/);
    assert.match(html, /data-slot="company-mention-2"[^>]*>EAB/);
    assert.match(html, /data-slot="company-mention-3"[^>]*>EAB/);
    assert.match(html, /data-slot="role-keyword"[^>]*>Senior Director/);
    assert.match(html, /class="dot"/);
  });

  it("treats resume_page_count_high as review when PDF is skipped so HTML still lands", async () => {
    let editorCalls = 0;
    const drafter = createMaterialsDrafter(
      baseDeps(dir, {
        editor: async () => {
          editorCalls += 1;
          return goodJson;
        },
        critic: async () => ({
          status: "fail",
          issues: [{ code: "resume_page_count_high", message: "3 pages", severity: "fail" }],
        }),
      }),
    );
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    await readFile(join(dir, "eab-role", "resume.html"), "utf8");
    await readFile(join(dir, "eab-role", "cover-letter.html"), "utf8");
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /resume_page_count_high/);
    assert.match(report, /^Status:\s*REVIEW/im);
    assert.doesNotMatch(report, /^Status:\s*READY/im);
    assert.doesNotMatch(report, /^Status:\s*FAIL/im);
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
    assert.equal(editorCalls, 0);
  });

  it("keeps the pre-merge scorecard when PDF page-count audit throws", async () => {
    const drafter = createMaterialsDrafter(
      baseDeps(dir, {
        pdfRenderer: async ({ resumePdfPath }) => {
          await mkdir(String(resumePdfPath), { recursive: true });
          return { skipped: false };
        },
      }),
    );
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    await readFile(join(dir, "eab-role", "resume.html"), "utf8");
    await readFile(join(dir, "eab-role", "cover-letter.html"), "utf8");
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /READY|pass/i);
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
  });

  it("reserves the same slug before any await so a concurrent enqueue is a no-op", async () => {
    const drafter = createMaterialsDrafter(baseDeps(dir));
    const payload = {
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    };
    const [first, second] = await Promise.all([
      drafter.enqueue(payload),
      drafter.enqueue({ ...payload, notes: "loser" }),
    ]);
    assert.equal(second.pending_path, first.pending_path);
    assert.equal(second.requested_at, first.requested_at);
    await drafter.runUntilIdle();
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
  });
});
