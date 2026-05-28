/**
 * Application Materials API — safe local file access for Hermes-generated
 * job application packages under ~/.hermes/job-hunt/applications/<slug>/.
 *
 * Contract (kept narrow on purpose):
 *   - Only directories matching the slug pattern are exposed.
 *   - Only an explicit allowlist of filenames is served.
 *   - File paths are confirmed to stay inside the resolved application dir
 *     (no path traversal via .. or symlink-style tricks).
 *   - A manifest is always derivable from on-disk files even when
 *     manifest.json is absent; manifest.json values win when present.
 *
 * The root can be overridden with HERMES_APPLICATIONS_ROOT for tests.
 */

import { readFile, readdir, stat, realpath, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, sep, basename } from "node:path";
import { homedir } from "node:os";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

const ALLOWED_FILES = new Set([
  "resume.pdf",
  "resume.html",
  "cover-letter.pdf",
  "cover-letter.html",
  "qa-report.md",
  "job-analysis.md",
  "job-description.md",
  "manual-apply-checklist.md",
  "manifest.json",
]);

const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * Document type definitions used to fold the allowlisted filenames
 * into user-facing cards. Order matters: it's the default render order.
 */
const DOC_TYPES = [
  {
    type: "resume",
    label: "Tailored Resume",
    files: ["resume.pdf", "resume.html"],
    primary: "resume.pdf",
  },
  {
    type: "cover_letter",
    label: "Cover Letter",
    files: ["cover-letter.pdf", "cover-letter.html"],
    primary: "cover-letter.pdf",
  },
  {
    type: "job_analysis",
    label: "Job Analysis",
    files: ["job-analysis.md"],
    primary: "job-analysis.md",
  },
  {
    type: "qa_report",
    label: "QA Report",
    files: ["qa-report.md"],
    primary: "qa-report.md",
  },
  {
    type: "job_description",
    label: "Job Description",
    files: ["job-description.md"],
    primary: "job-description.md",
  },
  {
    type: "manual_apply_checklist",
    label: "Apply Checklist",
    files: ["manual-apply-checklist.md"],
    primary: "manual-apply-checklist.md",
  },
];

export function getApplicationsRoot() {
  const override = process.env.HERMES_APPLICATIONS_ROOT;
  if (override) return override;
  return join(homedir(), ".hermes", "job-hunt", "applications");
}

export function isValidSlug(slug) {
  if (typeof slug !== "string" || slug.length === 0) return false;
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) return false;
  return SLUG_PATTERN.test(slug);
}

export function isAllowedFilename(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (basename(name) !== name) return false;
  return ALLOWED_FILES.has(name);
}

export function contentTypeFor(filename) {
  const idx = filename.lastIndexOf(".");
  if (idx < 0) return "application/octet-stream";
  const ext = filename.slice(idx).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function titleCase(words) {
  return words
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function deriveCompanyAndTitle(slug) {
  // Best-effort split on first dash. Real values come from manifest.json
  // when present; this is only a fallback for the UI when it isn't.
  const parts = slug.split("-").filter(Boolean);
  if (parts.length === 0) return { company: "", title: "" };
  if (parts.length === 1) return { company: titleCase(parts), title: "" };
  return {
    company: titleCase([parts[0]]),
    title: titleCase(parts.slice(1)),
  };
}

async function listAllowedFiles(dir) {
  const result = new Map();
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return result;
  }
  for (const name of names) {
    if (!ALLOWED_FILES.has(name)) continue;
    try {
      const st = await stat(join(dir, name));
      if (!st.isFile()) continue;
      const idx = name.lastIndexOf(".");
      const format = idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
      result.set(name, {
        filename: name,
        format,
        size: st.size,
        modifiedAt: st.mtime.toISOString(),
      });
    } catch {
      /* skip unreadable entry */
    }
  }
  return result;
}

/**
 * Resolve and validate the absolute directory for a given slug.
 *
 * Throws an HTTP-tagged error on invalid slug, missing dir, or any path
 * that would escape the configured applications root (via symlinks etc).
 */
export async function resolveApplicationDir(slug, { root } = {}) {
  if (!isValidSlug(slug)) {
    throw httpError("Invalid application slug", 400);
  }
  const base = root || getApplicationsRoot();
  const dir = join(base, slug);
  if (!dir.startsWith(base + sep) && dir !== base) {
    throw httpError("Path escape detected", 400);
  }
  if (!existsSync(dir)) {
    throw httpError("Application not found", 404);
  }
  let realDir;
  try {
    realDir = await realpath(dir);
  } catch {
    throw httpError("Application not found", 404);
  }
  let realBase;
  try {
    realBase = await realpath(base);
  } catch {
    realBase = base;
  }
  if (!(realDir === realBase || realDir.startsWith(realBase + sep))) {
    throw httpError("Path escape detected", 400);
  }
  const st = await stat(realDir);
  if (!st.isDirectory()) {
    throw httpError("Not a directory", 404);
  }
  return realDir;
}

/**
 * Build the public-facing manifest for an application package.
 *
 * Always returns the same shape regardless of whether manifest.json is
 * present, so the dashboard never needs to special-case missing files.
 */
export async function buildManifest(slug, { root } = {}) {
  const dir = await resolveApplicationDir(slug, { root });
  const manifestPath = join(dir, "manifest.json");
  let onDiskManifest = null;
  let derived = true;
  if (existsSync(manifestPath)) {
    try {
      const txt = await readFile(manifestPath, "utf8");
      onDiskManifest = JSON.parse(txt);
      derived = false;
    } catch {
      onDiskManifest = null;
      derived = true;
    }
  }
  const fileStats = await listAllowedFiles(dir);
  const documents = [];
  for (const def of DOC_TYPES) {
    const present = def.files
      .map((f) => fileStats.get(f))
      .filter(Boolean);
    if (!present.length) continue;
    const primaryFile = fileStats.get(def.primary) || present[0];
    const lastModifiedAt = present.reduce(
      (acc, s) => (s.modifiedAt > acc ? s.modifiedAt : acc),
      "",
    );
    documents.push({
      type: def.type,
      label: def.label,
      status: "ready",
      primary: primaryFile.filename,
      files: present.map((s) => ({
        filename: s.filename,
        format: s.format,
        size: s.size,
        modifiedAt: s.modifiedAt,
      })),
      lastModifiedAt,
    });
  }

  const updatedAt = documents.reduce(
    (acc, d) => (d.lastModifiedAt > acc ? d.lastModifiedAt : acc),
    "",
  );

  const inferred = deriveCompanyAndTitle(slug);
  const out = {
    slug,
    company: pickString(onDiskManifest && onDiskManifest.company, inferred.company),
    title: pickString(onDiskManifest && onDiskManifest.title, inferred.title),
    derived,
    updatedAt: updatedAt || pickString(onDiskManifest && onDiskManifest.updated_at, ""),
    documents,
  };
  if (onDiskManifest) {
    if (typeof onDiskManifest.job_url === "string") out.jobUrl = onDiskManifest.job_url;
    if (typeof onDiskManifest.status === "string") out.status = onDiskManifest.status;
    if (onDiskManifest.dossier && typeof onDiskManifest.dossier === "object") {
      out.dossier = onDiskManifest.dossier;
    }
  }
  /* pending.json is written by the Hermes materials_request.py script
   * when the user clicks "Draft cover letter" / "Tailor resume". The
   * Hermes side deletes it once the drafts ship; until then we expose
   * it so the UI shows a "Generating…" status on the affected cards. */
  const pendingPath = join(dir, "pending.json");
  if (existsSync(pendingPath)) {
    try {
      const pendingRaw = JSON.parse(await readFile(pendingPath, "utf8"));
      out.pending = {
        feature: typeof pendingRaw.feature === "string" ? pendingRaw.feature : "",
        requestedAt: typeof pendingRaw.requested_at === "string" ? pendingRaw.requested_at : "",
        telegramMessageId: Number.isFinite(pendingRaw.telegram_message_id)
          ? pendingRaw.telegram_message_id
          : null,
        notes: typeof pendingRaw.notes === "string" ? pendingRaw.notes : "",
        source: typeof pendingRaw.source === "string" ? pendingRaw.source : "",
      };
      /* Winky's materials_watcher writes a `progress` object into
       * pending.json as it works (phase, message, started_at,
       * updated_at, attempt, elapsed_seconds). We pass it through as
       * camelCase so the UI can render the spinning clock + per-phase
       * message + elapsed timer. Treat any field we don't recognise
       * defensively — Winky is on a separate machine and may evolve
       * the schema independently. */
      if (pendingRaw.progress && typeof pendingRaw.progress === "object") {
        const p = pendingRaw.progress;
        out.pending.progress = {
          phase: typeof p.phase === "string" ? p.phase : "",
          message: typeof p.message === "string" ? p.message : "",
          startedAt: typeof p.started_at === "string" ? p.started_at : "",
          updatedAt: typeof p.updated_at === "string" ? p.updated_at : "",
          attempt: Number.isFinite(p.attempt) ? p.attempt : 1,
          elapsedSeconds: Number.isFinite(p.elapsed_seconds) ? p.elapsed_seconds : 0,
        };
      }
    } catch {
      /* malformed pending.json: treat as no pending state */
    }
  }
  return out;
}

function pickString(preferred, fallback) {
  if (typeof preferred === "string" && preferred.trim()) return preferred;
  return fallback || "";
}

/**
 * Enumerate the applications root and build a manifest for each valid
 * subdirectory. Invalid slugs and unreadable folders are skipped quietly
 * so a single broken package never hides the rest.
 */
export async function listApplications({ root } = {}) {
  const base = root || getApplicationsRoot();
  if (!existsSync(base)) return [];
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidSlug(entry.name)) continue;
    try {
      manifests.push(await buildManifest(entry.name, { root: base }));
    } catch {
      /* skip broken entry */
    }
  }
  manifests.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return manifests;
}

/**
 * Resolve a single file inside an application package, validating both
 * the slug and the filename against the allowlist. Returns metadata
 * useful for streaming the response (content type, size, mtime).
 */
export async function resolveFile(slug, filename, { root } = {}) {
  if (!isAllowedFilename(filename)) {
    throw httpError("Filename not allowed", 400);
  }
  const dir = await resolveApplicationDir(slug, { root });
  const filePath = join(dir, filename);
  if (!filePath.startsWith(dir + sep)) {
    throw httpError("Path escape detected", 400);
  }
  if (!existsSync(filePath)) {
    throw httpError("File not found", 404);
  }
  let realPath;
  try {
    realPath = await realpath(filePath);
  } catch {
    throw httpError("File not found", 404);
  }
  if (!realPath.startsWith(dir + sep)) {
    throw httpError("Path escape detected", 400);
  }
  const st = await stat(realPath);
  if (!st.isFile()) {
    throw httpError("Not a file", 404);
  }
  return {
    absolutePath: realPath,
    size: st.size,
    contentType: contentTypeFor(filename),
    modifiedAt: st.mtime.toUTCString(),
  };
}

/**
 * Archive (don't delete) pending.json for a slug. Used by JobBored's
 * "Dismiss" button on a stuck FAILED progress card. Renames to
 * pending.json.dismissed.<UTC timestamp> so we never silently lose
 * the watcher's last-known state. Returns the archive path.
 *
 * Errors mirror resolveApplicationDir: 400 invalid slug / path escape,
 * 404 application/file not found.
 */
export async function dismissPending(slug, { root } = {}) {
  const dir = await resolveApplicationDir(slug, { root });
  const pendingPath = join(dir, "pending.json");
  if (!pendingPath.startsWith(dir + sep)) {
    throw httpError("Path escape detected", 400);
  }
  if (!existsSync(pendingPath)) {
    throw httpError("No pending request to dismiss", 404);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const archivePath = join(dir, `pending.json.dismissed.${stamp}`);
  await rename(pendingPath, archivePath);
  return { archivePath, dismissedAt: new Date().toISOString() };
}
