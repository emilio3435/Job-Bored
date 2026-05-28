/**
 * Tests for server/application-materials.mjs — the safe local file
 * access surface that backs the JobBored Application Materials cards.
 *
 * Covers, in this order:
 *   - slug + filename allowlist behaviour
 *   - manifest discovery from on-disk files (no manifest.json needed)
 *   - manifest precedence when manifest.json is present
 *   - resolveFile path-traversal protection (.., absolute paths, symlinks)
 *   - content type mapping
 *   - listApplications skipping invalid / unreadable folders
 */

import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, mkdir, writeFile, symlink, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isValidSlug,
  isAllowedFilename,
  contentTypeFor,
  resolveApplicationDir,
  resolveFile,
  buildManifest,
  listApplications,
} from "../server/application-materials.mjs";

let root;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "jb-materials-"));

  // chartis package: full set of allowlisted files, no manifest.json.
  const chartis = join(root, "chartis-senior-digital-marketing-consultant");
  await mkdir(chartis);
  await writeFile(join(chartis, "resume.pdf"), "PDFDATA");
  await writeFile(join(chartis, "resume.html"), "<html>resume</html>");
  await writeFile(join(chartis, "cover-letter.pdf"), "COVERPDF");
  await writeFile(join(chartis, "cover-letter.html"), "<html>cover</html>");
  await writeFile(join(chartis, "qa-report.md"), "# QA\nOK");
  await writeFile(join(chartis, "job-analysis.md"), "# Analysis");
  await writeFile(join(chartis, "job-description.md"), "# JD");

  // tegna package: manifest.json present, drives company + title.
  const tegna = join(root, "tegna-digital-sales-manager");
  await mkdir(tegna);
  await writeFile(join(tegna, "resume.pdf"), "PDF");
  await writeFile(join(tegna, "cover-letter.pdf"), "PDF");
  await writeFile(join(tegna, "manifest.json"), JSON.stringify({
    slug: "tegna-digital-sales-manager",
    company: "TEGNA",
    title: "Digital Sales Manager",
    status: "materials_ready",
    job_url: "https://example.com/jobs/9",
  }));

  // unrelated junk folders the listing must skip.
  await mkdir(join(root, "_partial_results"));
  await writeFile(join(root, "loose-file.txt"), "ignored");
});

after(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("isValidSlug", () => {
  it("accepts lowercase dashed slugs", () => {
    assert.equal(isValidSlug("chartis-senior-digital-marketing-consultant"), true);
    assert.equal(isValidSlug("tegna-digital-sales-manager"), true);
    assert.equal(isValidSlug("a"), true);
  });
  it("rejects path traversal, uppercase, and reserved prefixes", () => {
    assert.equal(isValidSlug(""), false);
    assert.equal(isValidSlug(".."), false);
    assert.equal(isValidSlug("../etc/passwd"), false);
    assert.equal(isValidSlug("a/b"), false);
    assert.equal(isValidSlug("a\\b"), false);
    assert.equal(isValidSlug("-leading-dash"), false);
    assert.equal(isValidSlug("UPPER"), false);
    assert.equal(isValidSlug("a".repeat(200)), false);
  });
});

describe("isAllowedFilename", () => {
  it("accepts every documented allowlist entry", () => {
    for (const name of [
      "resume.pdf",
      "resume.html",
      "cover-letter.pdf",
      "cover-letter.html",
      "qa-report.md",
      "job-analysis.md",
      "job-description.md",
      "manual-apply-checklist.md",
      "manifest.json",
    ]) {
      assert.equal(isAllowedFilename(name), true, name);
    }
  });
  it("rejects anything not on the allowlist or with traversal", () => {
    assert.equal(isAllowedFilename(""), false);
    assert.equal(isAllowedFilename("secrets.env"), false);
    assert.equal(isAllowedFilename("../resume.pdf"), false);
    assert.equal(isAllowedFilename("subdir/resume.pdf"), false);
    assert.equal(isAllowedFilename("Resume.pdf"), false);
    assert.equal(isAllowedFilename("resume.pdf "), false);
  });
});

describe("contentTypeFor", () => {
  it("maps known extensions", () => {
    assert.equal(contentTypeFor("resume.pdf"), "application/pdf");
    assert.equal(contentTypeFor("resume.html"), "text/html; charset=utf-8");
    assert.equal(contentTypeFor("qa-report.md"), "text/markdown; charset=utf-8");
    assert.equal(contentTypeFor("manifest.json"), "application/json; charset=utf-8");
  });
  it("falls back to octet-stream for unknown extensions", () => {
    assert.equal(contentTypeFor("foo"), "application/octet-stream");
    assert.equal(contentTypeFor("foo.bin"), "application/octet-stream");
  });
});

describe("resolveApplicationDir", () => {
  it("returns the absolute dir for a real slug", async () => {
    const dir = await resolveApplicationDir(
      "chartis-senior-digital-marketing-consultant",
      { root },
    );
    assert.ok(dir.endsWith("chartis-senior-digital-marketing-consultant"));
  });
  it("rejects invalid slugs with a 400", async () => {
    await assert.rejects(
      () => resolveApplicationDir("../etc/passwd", { root }),
      (err) => err.statusCode === 400,
    );
  });
  it("returns 404 when the slug is not on disk", async () => {
    await assert.rejects(
      () => resolveApplicationDir("does-not-exist", { root }),
      (err) => err.statusCode === 404,
    );
  });
});

describe("buildManifest", () => {
  it("derives company + title from slug when manifest.json is missing", async () => {
    const manifest = await buildManifest(
      "chartis-senior-digital-marketing-consultant",
      { root },
    );
    assert.equal(manifest.derived, true);
    assert.equal(manifest.slug, "chartis-senior-digital-marketing-consultant");
    assert.equal(manifest.company, "Chartis");
    assert.equal(manifest.title, "Senior Digital Marketing Consultant");
    const resume = manifest.documents.find((d) => d.type === "resume");
    assert.ok(resume);
    assert.equal(resume.primary, "resume.pdf");
    assert.equal(resume.files.length, 2);
    const cover = manifest.documents.find((d) => d.type === "cover_letter");
    assert.ok(cover);
    const qa = manifest.documents.find((d) => d.type === "qa_report");
    assert.ok(qa);
    const jobAnalysis = manifest.documents.find((d) => d.type === "job_analysis");
    assert.ok(jobAnalysis);
    assert.ok(manifest.updatedAt);
  });

  it("prefers manifest.json company + title when present", async () => {
    const manifest = await buildManifest("tegna-digital-sales-manager", { root });
    assert.equal(manifest.derived, false);
    assert.equal(manifest.company, "TEGNA");
    assert.equal(manifest.title, "Digital Sales Manager");
    assert.equal(manifest.status, "materials_ready");
    assert.equal(manifest.jobUrl, "https://example.com/jobs/9");
    const resume = manifest.documents.find((d) => d.type === "resume");
    assert.ok(resume);
  });

  it("orders documents by readiness regardless of fs ordering", async () => {
    const manifest = await buildManifest(
      "chartis-senior-digital-marketing-consultant",
      { root },
    );
    const types = manifest.documents.map((d) => d.type);
    assert.deepEqual(
      types.slice(0, 2).sort(),
      ["cover_letter", "resume"],
      "primary types should be present in the first two slots",
    );
  });

  it("attaches quality metadata for sparse two-page resumes", async () => {
    const dir = join(root, "sparse-two-page-role");
    await mkdir(dir);
    await writeFile(join(dir, "resume.pdf"), "%PDF\n/Type /Page\n/Type /Page\n");
    await writeFile(join(dir, "resume.html"), `
      <article class="page" data-page="1">
        <section data-section="summary">Summary text.</section>
        <section data-section="experience">${"Managed campaigns. ".repeat(60)}</section>
      </article>
      <article class="page" data-page="2">
        <section data-section="founder-work">Built AI tools.</section>
      </article>
    `);

    const manifest = await buildManifest("sparse-two-page-role", { root });
    assert.equal(manifest.quality.version, "materials-quality.v1");
    assert.equal(manifest.quality.documents.resume.status, "review");
    assert.ok(
      manifest.quality.documents.resume.issues.some(
        (item) => item.code === "resume_two_page_sparse",
      ),
      "sparse two-page resumes should be flagged for review",
    );
    assert.ok(
      manifest.quality.documents.resume.issues.some(
        (item) => item.code === "resume_second_page_sparse",
      ),
      "short second pages should be flagged for review",
    );
  });

  it("surfaces pending.json when present", async () => {
    const pendingDir = join(root, "pending-only-package");
    await mkdir(pendingDir);
    await writeFile(join(pendingDir, "pending.json"), JSON.stringify({
      slug: "pending-only-package",
      company: "Pending Co",
      title: "Pending Role",
      feature: "cover_letter",
      requested_at: "2026-05-27T20:00:00Z",
      telegram_message_id: 12345,
      notes: "Make it tight.",
      source: "jobbored-dossier",
    }));
    const manifest = await buildManifest("pending-only-package", { root });
    assert.ok(manifest.pending, "pending block should be attached");
    assert.equal(manifest.pending.feature, "cover_letter");
    assert.equal(manifest.pending.requestedAt, "2026-05-27T20:00:00Z");
    assert.equal(manifest.pending.telegramMessageId, 12345);
    assert.equal(manifest.pending.notes, "Make it tight.");
    assert.equal(manifest.pending.source, "jobbored-dossier");
    assert.deepEqual(manifest.documents, []);
  });

  it("ignores malformed pending.json without throwing", async () => {
    const dir = join(root, "broken-pending-package");
    await mkdir(dir);
    await writeFile(join(dir, "pending.json"), "{ this is not valid json");
    const manifest = await buildManifest("broken-pending-package", { root });
    assert.equal(manifest.pending, undefined);
  });

  it("surfaces the progress block when Dobby has populated it", async () => {
    const dir = join(root, "progress-state-package");
    await mkdir(dir);
    await writeFile(join(dir, "pending.json"), JSON.stringify({
      slug: "progress-state-package",
      company: "Progress Co",
      title: "Progress Role",
      feature: "both",
      requested_at: "2026-05-28T10:00:00Z",
      progress: {
        phase: "drafting",
        message: "Winky is drafting your cover letter and tailoring your resume…",
        started_at: "2026-05-28T10:00:05Z",
        updated_at: "2026-05-28T10:02:30Z",
        attempt: 1,
        elapsed_seconds: 145,
      },
    }));
    const manifest = await buildManifest("progress-state-package", { root });
    assert.ok(manifest.pending, "pending block should be attached");
    assert.ok(manifest.pending.progress, "progress block should be attached");
    assert.equal(manifest.pending.progress.phase, "drafting");
    assert.equal(
      manifest.pending.progress.message,
      "Dobby is drafting your cover letter and tailoring your resume…",
    );
    assert.equal(manifest.pending.progress.startedAt, "2026-05-28T10:00:05Z");
    assert.equal(manifest.pending.progress.elapsedSeconds, 145);
    assert.equal(manifest.pending.progress.attempt, 1);
  });
});

describe("dismissPending", () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jb-mats-dismiss-"));
  });
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("archives pending.json with a dismissed.<stamp> suffix", async () => {
    const dir = join(root, "dismiss-test-slug");
    await mkdir(dir);
    await writeFile(join(dir, "pending.json"), JSON.stringify({
      slug: "dismiss-test-slug",
      feature: "cover_letter",
      progress: { phase: "failed", message: "Missing job-description.md" },
    }));
    const { dismissPending } = await import("../server/application-materials.mjs");
    const result = await dismissPending("dismiss-test-slug", { root });
    assert.ok(result.archivePath, "result should include archive path");
    assert.match(result.archivePath, /pending\.json\.dismissed\.\d{8}T\d{6}Z$/);
    /* Original file should be gone; archive should exist. */
    assert.equal(existsSync(join(dir, "pending.json")), false);
    assert.equal(existsSync(result.archivePath), true);
  });

  it("returns 404 when no pending.json is on disk", async () => {
    const dir = join(root, "no-pending-slug");
    await mkdir(dir);
    const { dismissPending } = await import("../server/application-materials.mjs");
    await assert.rejects(
      () => dismissPending("no-pending-slug", { root }),
      (e) => e.statusCode === 404,
    );
  });

  it("rejects invalid slugs without touching disk", async () => {
    const { dismissPending } = await import("../server/application-materials.mjs");
    await assert.rejects(
      () => dismissPending("../etc/passwd", { root }),
      (e) => e.statusCode === 400,
    );
  });
});

describe("resolveFile", () => {
  it("returns a real path inside the application dir", async () => {
    const meta = await resolveFile(
      "chartis-senior-digital-marketing-consultant",
      "resume.pdf",
      { root },
    );
    assert.equal(meta.contentType, "application/pdf");
    assert.ok(meta.size > 0);
    assert.ok(meta.absolutePath.includes("chartis-senior-digital-marketing-consultant"));
    assert.ok(meta.modifiedAt);
  });

  it("rejects path traversal attempts before touching the filesystem", async () => {
    await assert.rejects(
      () => resolveFile(
        "chartis-senior-digital-marketing-consultant",
        "../tegna-digital-sales-manager/resume.pdf",
        { root },
      ),
      (err) => err.statusCode === 400,
    );
  });

  it("rejects unlisted filenames even if the file exists on disk", async () => {
    /* qa-report.md is on-disk for chartis; .env is not allowlisted. */
    await assert.rejects(
      () => resolveFile("chartis-senior-digital-marketing-consultant", "secrets.env", { root }),
      (err) => err.statusCode === 400,
    );
  });

  it("rejects symlinks that point outside the application dir", async () => {
    const slug = "symlink-escape-test";
    const dir = join(root, slug);
    await mkdir(dir);
    /* Make the file we'll point to live outside this app dir but still
       under the temp root, then symlink resume.pdf to it. The realpath
       check must reject the escape even though the link target exists. */
    const escapeTarget = join(root, "tegna-digital-sales-manager", "resume.pdf");
    try {
      await symlink(escapeTarget, join(dir, "resume.pdf"));
    } catch (e) {
      /* Some sandboxes disallow symlinks; treat as skip. */
      return;
    }
    await assert.rejects(
      () => resolveFile(slug, "resume.pdf", { root }),
      (err) => err.statusCode === 400,
    );
  });
});

describe("listApplications", () => {
  it("returns valid packages and skips invalid / non-dir entries", async () => {
    const apps = await listApplications({ root });
    const slugs = apps.map((a) => a.slug).sort();
    /* The list now includes everything we created across this file:
       chartis, tegna, the symlink-escape test dir, plus the pending-
       only and broken-pending packages added for the pending tests. */
    assert.ok(slugs.includes("chartis-senior-digital-marketing-consultant"));
    assert.ok(slugs.includes("tegna-digital-sales-manager"));
    assert.ok(!slugs.includes("_partial_results"), "underscore-prefixed dirs should be skipped");
    /* Sorted by updatedAt desc — the entry with the newer files wins. */
    const tegna = apps.find((a) => a.slug === "tegna-digital-sales-manager");
    assert.ok(tegna);
  });

  it("returns an empty array when the root does not exist", async () => {
    const result = await listApplications({ root: join(root, "missing-subdir") });
    assert.deepEqual(result, []);
  });
});

describe("writeJobDescription", () => {
  /* writeJobDescription always writes under the production
     getApplicationsRoot() (it doesn't take a `root` option because it
     also creates dirs on demand). We stub HOME so the call lands in
     an isolated tmpdir for the duration of the test. */
  let scratch;
  let prevHome;
  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "jb-mats-jd-"));
    prevHome = process.env.HOME;
    process.env.HOME = scratch;
  });
  afterEach(async () => {
    process.env.HOME = prevHome;
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  it("creates the application dir if missing and writes job-description.md", async () => {
    const { writeJobDescription } = await import("../server/application-materials.mjs");
    const result = await writeJobDescription("brand-new-slug", "Body of the JD here. " + "X".repeat(60), {
      source: "user-paste",
      jobUrl: "https://example.com/job/123",
    });
    assert.ok(result.path.endsWith("/brand-new-slug/job-description.md"));
    assert.ok(result.bytesWritten > 0);
    assert.equal(result.source, "user-paste");
    assert.equal(existsSync(result.path), true);
  });

  it("rejects empty text with 400", async () => {
    const { writeJobDescription } = await import("../server/application-materials.mjs");
    await assert.rejects(
      () => writeJobDescription("brand-new-slug", "   ", {}),
      (e) => e.statusCode === 400,
    );
  });

  it("rejects oversized text with 413", async () => {
    const { writeJobDescription } = await import("../server/application-materials.mjs");
    const tooBig = "A".repeat(500_001);
    await assert.rejects(
      () => writeJobDescription("brand-new-slug", tooBig, {}),
      (e) => e.statusCode === 413,
    );
  });

  it("rejects invalid slugs without touching disk", async () => {
    const { writeJobDescription } = await import("../server/application-materials.mjs");
    await assert.rejects(
      () => writeJobDescription("../../etc/passwd", "valid text " + "X".repeat(60), {}),
      (e) => e.statusCode === 400,
    );
  });
});

describe("listPendingQueue", () => {
  let root;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "jb-mats-queue-"));
  });
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("returns pending requests FIFO by requested_at across slugs", async () => {
    await mkdir(join(root, "alpha-co"));
    await writeFile(join(root, "alpha-co", "pending.json"), JSON.stringify({
      slug: "alpha-co",
      company: "Alpha",
      title: "Alpha Role",
      feature: "cover_letter",
      requested_at: "2026-05-28T10:00:00Z",
    }));
    await mkdir(join(root, "bravo-co"));
    await writeFile(join(root, "bravo-co", "pending.json"), JSON.stringify({
      slug: "bravo-co",
      company: "Bravo",
      title: "Bravo Role",
      feature: "both",
      requested_at: "2026-05-28T09:30:00Z",
      progress: {
        phase: "drafting",
        message: "Winky is drafting your cover letter…",
        started_at: "2026-05-28T09:31:00Z",
        elapsed_seconds: 60,
      },
    }));
    const { listPendingQueue } = await import("../server/application-materials.mjs");
    const queue = await listPendingQueue({ root });
    assert.equal(queue.length, 2);
    /* Bravo requested earlier, so it's first. */
    assert.equal(queue[0].slug, "bravo-co");
    assert.equal(queue[0].progress.phase, "drafting");
    assert.equal(queue[0].progress.message, "Dobby is drafting your cover letter…");
    assert.equal(queue[1].slug, "alpha-co");
    assert.equal(queue[1].progress, null);
  });

  it("returns [] when no pending.json files exist", async () => {
    await mkdir(join(root, "no-pending-here"));
    const { listPendingQueue } = await import("../server/application-materials.mjs");
    assert.deepEqual(await listPendingQueue({ root }), []);
  });

  it("skips invalid slug directories", async () => {
    await mkdir(join(root, "_partial_results"));
    await writeFile(join(root, "_partial_results", "pending.json"), '{"slug":"x"}');
    const { listPendingQueue } = await import("../server/application-materials.mjs");
    assert.deepEqual(await listPendingQueue({ root }), []);
  });

  it("skips corrupt pending.json without throwing", async () => {
    await mkdir(join(root, "broken-co"));
    await writeFile(join(root, "broken-co", "pending.json"), "{ not valid json");
    await mkdir(join(root, "ok-co"));
    await writeFile(join(root, "ok-co", "pending.json"), JSON.stringify({
      slug: "ok-co",
      feature: "resume",
      requested_at: "2026-05-28T10:00:00Z",
    }));
    const { listPendingQueue } = await import("../server/application-materials.mjs");
    const queue = await listPendingQueue({ root });
    assert.equal(queue.length, 1);
    assert.equal(queue[0].slug, "ok-co");
  });
});
