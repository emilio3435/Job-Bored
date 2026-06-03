/**
 * Brand logo bridge for resume-template logo marks.
 *
 * The Python resolver owns the actual upload/favicon/monogram resolution.
 * This module keeps the Express surface small: validate uploads, write the
 * profile-derived manifest, spawn the resolver, and report current marks.
 */
import { spawn } from "node:child_process";
import {
  mkdir,
  realpath,
  readFile,
  writeFile,
  rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve as resolvePath,
} from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 45_000;

const IMAGE_MAGIC = [
  Buffer.from("\x89PNG\r\n\x1a\n", "binary"),
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from("GIF87a"),
  Buffer.from("GIF89a"),
  Buffer.from([0x00, 0x00, 0x01, 0x00]),
  Buffer.from("RIFF"),
];

function defaultIntegrationRoot() {
  return resolvePath(__dirname, "..", "integrations", "hermes-job-hunt");
}

function defaultTemplateRoot() {
  return join(defaultIntegrationRoot(), "resume-template");
}

function requireAbsoluteEnvPath(name, value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (!isAbsolute(trimmed)) {
    throw new Error(`${name} must be absolute; got "${trimmed}"`);
  }
  return trimmed;
}

export function getBrandLogosTemplateRoot() {
  const direct = requireAbsoluteEnvPath(
    "HERMES_RESUME_TEMPLATE_DIR",
    process.env.HERMES_RESUME_TEMPLATE_DIR,
  );
  if (direct) return direct;

  const jobHuntRoot = requireAbsoluteEnvPath(
    "HERMES_JOB_HUNT_ROOT",
    process.env.HERMES_JOB_HUNT_ROOT,
  );
  if (jobHuntRoot) return join(jobHuntRoot, "resume-template");

  const hermesRoot = requireAbsoluteEnvPath("HERMES_ROOT", process.env.HERMES_ROOT);
  if (hermesRoot) return join(hermesRoot, "job-hunt", "resume-template");

  const liveTemplateRoot = join(homedir(), ".hermes", "job-hunt", "resume-template");
  if (existsSync(liveTemplateRoot)) return liveTemplateRoot;

  return defaultTemplateRoot();
}

export function getLogoResolverScript() {
  return (
    process.env.HERMES_LOGO_RESOLVER_SCRIPT ||
    join(defaultIntegrationRoot(), "scripts", "logo_resolver.py")
  );
}

function isValidSlug(slug) {
  return SLUG_PATTERN.test(String(slug || ""));
}

function makeError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isWithinResolvedRoot(root, target) {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  return target === root || target.startsWith(normalizedRoot);
}

async function resolveTemplateRoot(templateRoot = getBrandLogosTemplateRoot()) {
  await mkdir(templateRoot, { recursive: true });
  return realpath(templateRoot);
}

async function safeTemplatePath(templateRoot, relativePath, options = {}) {
  const root = await resolveTemplateRoot(templateRoot);
  const target = resolvePath(root, relativePath);
  if (!isWithinResolvedRoot(root, target)) {
    throw makeError("Path escapes resume template root", 400);
  }

  const parent = dirname(target);
  if (options.ensureParent) await mkdir(parent, { recursive: true });
  const parentReal = await realpath(parent);
  if (!isWithinResolvedRoot(root, parentReal)) {
    throw makeError("Template subdirectory escapes resume template root", 400);
  }

  if (existsSync(target)) {
    const targetReal = await realpath(target);
    if (!isWithinResolvedRoot(root, targetReal)) {
      throw makeError("Template file escapes resume template root", 400);
    }
  }
  return target;
}

async function writeFileAtomic(path, data) {
  const tmpPath = join(
    dirname(path),
    `.tmp-${basename(path)}.${process.pid}.${Date.now()}`,
  );
  await writeFile(tmpPath, data);
  await rename(tmpPath, path);
}

function parseResolverReport(stdout) {
  const rows = [];
  String(stdout || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || /^\d+\s+marks:/.test(trimmed)) return;
      const match = trimmed.match(/^\S+\s+([a-z0-9-]+)\s+([a-z_]+)\s*(.*)$/i);
      if (!match) return;
      rows.push({
        slug: match[1],
        source: match[2],
        detail: (match[3] || "").trim(),
      });
    });
  return rows;
}

async function readManifest(templateRoot = getBrandLogosTemplateRoot()) {
  const path = await safeTemplatePath(templateRoot, "logos.json", {
    ensureParent: true,
  });
  if (!existsSync(path)) return { logos: [] };
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && Array.isArray(parsed.logos)
    ? parsed
    : { logos: [] };
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(tmpPath, path);
}

export async function runResolver({ force = false, templateRoot } = {}) {
  const root = await resolveTemplateRoot(templateRoot || getBrandLogosTemplateRoot());
  const manifest = await readManifest(root);
  if (!manifest.logos.length) return [];

  const script = getLogoResolverScript();
  const args = [script, "--template-dir", root];
  if (force) args.push("--force");

  return new Promise((resolveFn, rejectFn) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("python3", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      rejectFn(makeError("logo resolver timed out", 504));
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectFn(makeError(`logo resolver spawn error: ${err.message}`, 500));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) return resolveFn(parseResolverReport(stdout));
      rejectFn(makeError(stderr.trim() || `logo resolver exited ${code}`, 502));
    });
  });
}

export function looksLikeImage(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (buffer.length < 16) return false;
  if (buffer.subarray(8, 12).equals(Buffer.from("WEBP"))) return true;
  const trimmed = buffer.subarray(0, 512).toString("utf8").trimStart();
  if (/^<svg[\s>]/i.test(trimmed)) return true;
  return IMAGE_MAGIC.some((magic) => buffer.subarray(0, magic.length).equals(magic));
}

function imageMime(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (buffer.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"))) {
    return "image/png";
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (buffer.subarray(8, 12).equals(Buffer.from("WEBP"))) return "image/webp";
  if (buffer.subarray(0, 6).equals(Buffer.from("GIF87a")) ||
      buffer.subarray(0, 6).equals(Buffer.from("GIF89a"))) {
    return "image/gif";
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) {
    return "image/x-icon";
  }
  if (/^<svg[\s>]/i.test(buffer.subarray(0, 512).toString("utf8").trimStart())) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function normalizeDomain(raw) {
  let value = String(raw || "").trim();
  if (!value) return "";
  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  value = value.split(/[/?#]/)[0].trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? value : "";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

function normalizeLogoUpload(value, slug) {
  if (value === true && isValidSlug(slug)) {
    return `uploads/logo-${slug}.png`;
  }
  if (typeof value === "string") {
    const filename = basename(value.trim());
    return filename ? join("uploads", filename) : "";
  }
  return "";
}

function getProfileLogoCollections(source) {
  return []
    .concat(Array.isArray(source.experiences) ? source.experiences : [])
    .concat(Array.isArray(source.projects) ? source.projects : [])
    .concat(Array.isArray(source.workHistory) ? source.workHistory : [])
    .concat(Array.isArray(source.portfolio) ? source.portfolio : [])
    .concat(Array.isArray(source.caseStudies) ? source.caseStudies : []);
}

export function buildLogoManifestFromProfile(profile, priorManifest = null) {
  const source = profile && typeof profile === "object" ? profile : {};
  const priorBySlug = new Map();
  if (priorManifest && Array.isArray(priorManifest.logos)) {
    priorManifest.logos.forEach((entry) => {
      if (entry && isValidSlug(entry.slug)) priorBySlug.set(entry.slug, entry);
    });
  }
  const collections = getProfileLogoCollections(source);
  const seen = new Set();
  const logos = [];

  collections.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const label =
      String(item.label || item.company || item.name || item.title || "").trim();
    const slug = isValidSlug(item.slug) ? String(item.slug) : slugify(label);
    if (!slug || !isValidSlug(slug) || seen.has(slug)) return;
    seen.add(slug);
    const entry = { slug, label: label || slug };
    const domain = normalizeDomain(item.logoDomain || item.domain || item.website);
    if (domain) entry.domain = domain;
    const prior = priorBySlug.get(slug) || null;
    const upload =
      normalizeLogoUpload(item.logoUpload, slug) ||
      (prior && typeof prior.upload === "string" ? prior.upload : "");
    if (upload) entry.upload = upload;
    logos.push(entry);
  });

  return {
    $comment:
      "Generated from ~/.jobbored/profile.json experiences/projects. Resolved by scripts/logo_resolver.py into assets/logo-<slug>.png.",
    logos,
  };
}

export async function writeLogoManifestFromProfile(profile, { templateRoot } = {}) {
  const root = await resolveTemplateRoot(templateRoot || getBrandLogosTemplateRoot());
  const priorManifest = await readManifest(root);
  const manifest = buildLogoManifestFromProfile(profile, priorManifest);
  await writeJsonAtomic(await safeTemplatePath(root, "logos.json", { ensureParent: true }), manifest);
  return { templateRoot: root, manifest };
}

export async function refreshLogosFromProfile(profile, options = {}) {
  const written = await writeLogoManifestFromProfile(profile, options);
  const resolved = await runResolver({
    force: false,
    templateRoot: written.templateRoot,
  });
  return { ...written, resolved };
}

export async function saveUpload(slug, buffer, { templateRoot } = {}) {
  const normalizedSlug = String(slug || "").trim();
  if (!isValidSlug(normalizedSlug)) throw makeError("Invalid slug", 400);
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!data.length) throw makeError("Upload is empty", 400);
  if (data.length > MAX_UPLOAD_BYTES) throw makeError("Upload exceeds 2 MB", 413);
  if (!looksLikeImage(data)) throw makeError("Upload must be an image", 400);

  const root = await resolveTemplateRoot(templateRoot || getBrandLogosTemplateRoot());
  const uploadPath = await safeTemplatePath(
    root,
    join("uploads", `logo-${normalizedSlug}.png`),
    { ensureParent: true },
  );
  await writeFileAtomic(uploadPath, data);
  const manifest = await readManifest(root);
  const upload = `uploads/logo-${normalizedSlug}.png`;
  const existing = manifest.logos.find((entry) => entry && entry.slug === normalizedSlug);
  if (existing) {
    existing.upload = upload;
  } else {
    manifest.logos.push({
      slug: normalizedSlug,
      label: normalizedSlug,
      upload,
    });
  }
  await writeJsonAtomic(await safeTemplatePath(root, "logos.json", { ensureParent: true }), manifest);
  const resolved = await runResolver({ force: true, templateRoot: root });
  return {
    ok: true,
    slug: normalizedSlug,
    upload,
    resolved,
  };
}

export async function listLogos({ templateRoot } = {}) {
  const root = await resolveTemplateRoot(templateRoot || getBrandLogosTemplateRoot());
  const manifest = await readManifest(root);
  const logos = [];
  for (const entry of manifest.logos) {
    const slug = String(entry && entry.slug ? entry.slug : "").trim();
    if (!isValidSlug(slug)) continue;
    const assetPath = await safeTemplatePath(root, join("assets", `logo-${slug}.png`), {
      ensureParent: true,
    });
    let mark = null;
    if (existsSync(assetPath)) {
      const data = await readFile(assetPath);
      mark = {
        path: `assets/logo-${slug}.png`,
        mime: imageMime(data),
        dataUrl: `data:${imageMime(data)};base64,${data.toString("base64")}`,
      };
    }
    const uploadPath = await safeTemplatePath(root, join("uploads", `logo-${slug}.png`), {
      ensureParent: true,
    });
    logos.push({
      slug,
      label: String(entry.label || slug),
      domain: entry.domain ? String(entry.domain) : "",
      upload: entry.upload ? String(entry.upload) : "",
      source: existsSync(uploadPath) ? "upload" : mark ? "resolved" : "missing",
      mark,
    });
  }
  return { templateRoot: root, logos };
}

export async function parseMultipartFile(req, { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw makeError("Expected multipart/form-data", 400);
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw makeError("Upload exceeds 2 MB", 413);
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const start = body.indexOf(boundary);
  if (start === -1) throw makeError("Malformed multipart body", 400);
  let cursor = start + boundary.length;
  while (cursor < body.length) {
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;
    const next = body.indexOf(boundary, cursor);
    if (next === -1) break;
    const part = body.subarray(cursor, next - 2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const data = part.subarray(headerEnd + 4);
      if (/name=["']?file["']?/i.test(headers) ||
          /filename=["'][^"']+["']/i.test(headers)) {
        return {
          filename: (headers.match(/filename=["']([^"']+)["']/i) || [])[1] || "upload",
          contentType: (headers.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || "",
          buffer: data,
        };
      }
    }
    cursor = next + boundary.length;
  }
  throw makeError("Multipart body must include a file", 400);
}

export const BRAND_LOGO_LIMITS = {
  MAX_UPLOAD_BYTES,
  SLUG_PATTERN,
  allowedExtensions: [".png", ".jpg", ".jpeg", ".svg", ".webp"],
};

export function assertAllowedUploadName(filename) {
  const ext = extname(String(filename || "").toLowerCase());
  if (!BRAND_LOGO_LIMITS.allowedExtensions.includes(ext)) {
    throw makeError("Upload must be png, jpg, svg, or webp", 400);
  }
}
