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

/** @typedef {{ slug: string, label: string, domain?: string, upload?: string, shape?: LogoShape }} LogoEntry */
/** @typedef {"mark" | "wordmark" | "lockup"} LogoShape */
/** @typedef {{ $comment?: string, logos: LogoEntry[] }} LogoManifest */
/** @typedef {{ slug: string, source: string, detail: string }} ResolverRow */

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

/**
 * @param {string} name
 * @param {unknown} value
 */
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

/** @param {unknown} slug */
function isValidSlug(slug) {
  return SLUG_PATTERN.test(String(slug || ""));
}

/**
 * @param {string} message
 * @param {number} statusCode
 */
function makeError(message, statusCode) {
  const err = /** @type {Error & { statusCode: number }} */ (new Error(message));
  err.statusCode = statusCode;
  return err;
}

/**
 * @param {string} root
 * @param {string} target
 */
function isWithinResolvedRoot(root, target) {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  return target === root || target.startsWith(normalizedRoot);
}

/** @param {string} [templateRoot] */
async function resolveTemplateRoot(templateRoot = getBrandLogosTemplateRoot()) {
  await mkdir(templateRoot, { recursive: true });
  return realpath(templateRoot);
}

/**
 * @param {string} templateRoot
 * @param {string} relativePath
 * @param {{ ensureParent?: boolean }} [options]
 */
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

/**
 * @param {string} path
 * @param {string | NodeJS.ArrayBufferView} data
 */
async function writeFileAtomic(path, data) {
  const tmpPath = join(
    dirname(path),
    `.tmp-${basename(path)}.${process.pid}.${Date.now()}`,
  );
  await writeFile(tmpPath, data);
  await rename(tmpPath, path);
}

/**
 * @param {unknown} stdout
 * @returns {ResolverRow[]}
 */
function parseResolverReport(stdout) {
  /** @type {ResolverRow[]} */
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

/**
 * @param {string} [templateRoot]
 * @returns {Promise<LogoManifest>}
 */
async function readManifest(templateRoot = getBrandLogosTemplateRoot()) {
  const path = await safeTemplatePath(templateRoot, "logos.json", {
    ensureParent: true,
  });
  if (!existsSync(path)) return { logos: [] };
  const raw = await readFile(path, "utf8");
  const parsed = /** @type {LogoManifest | null} */ (JSON.parse(raw));
  return parsed && typeof parsed === "object" && Array.isArray(parsed.logos)
    ? parsed
    : { logos: [] };
}

/**
 * @param {string} path
 * @param {unknown} value
 */
async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(tmpPath, path);
}

/**
 * @param {{ force?: boolean, templateRoot?: string }} [options]
 * @returns {Promise<ResolverRow[]>}
 */
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

/** @param {Buffer | Uint8Array | string | number[] | null | undefined} data */
export function looksLikeImage(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (buffer.length < 16) return false;
  if (buffer.subarray(8, 12).equals(Buffer.from("WEBP"))) return true;
  const trimmed = buffer.subarray(0, 512).toString("utf8").trimStart();
  if (/^<svg[\s>]/i.test(trimmed)) return true;
  return IMAGE_MAGIC.some((magic) => buffer.subarray(0, magic.length).equals(magic));
}

/** @param {Buffer | Uint8Array | string | number[] | null | undefined} data */
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

/**
 * Pixel or user-unit dimensions of a PNG, GIF, WebP (VP8X) or SVG mark.
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number } | null}
 */
export function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && /^GIF8[79]a/.test(buffer.subarray(0, 6).toString("latin1"))) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 30 && buffer.subarray(8, 16).toString("latin1") === "WEBPVP8X") {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  const head = buffer.subarray(0, 4096).toString("utf8");
  const svg = /<svg\b[^>]*>/i.exec(head);
  if (svg) {
    const viewBox = /viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg[0]);
    if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
    const w = /\bwidth=["']([\d.]+)/i.exec(svg[0]);
    const h = /\bheight=["']([\d.]+)/i.exec(svg[0]);
    if (w && h) return { width: Number(w[1]), height: Number(h[1]) };
  }
  return null;
}

/**
 * The optical-size class a template sizes a mark by (visual spec §9.2 rule 3).
 * Square-ish marks are `mark`; wide ones spell a name and are `wordmark`. A
 * `lockup` (icon plus name) cannot be told from a wordmark by shape alone, so
 * it comes only from a manifest entry's explicit `shape`.
 *
 * @param {Buffer} buffer
 * @param {unknown} [declared] logos.json `shape`, which wins when valid
 * @returns {LogoShape}
 */
export function logoShape(buffer, declared) {
  if (declared === "mark" || declared === "wordmark" || declared === "lockup") return declared;
  const dims = imageDimensions(buffer);
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) return "mark";
  return dims.width / dims.height >= 1.8 ? "wordmark" : "mark";
}

/**
 * Resolved marks for the materials renderer, read-only: unlike listLogos()
 * this never creates the template folder. Missing folder → no marks.
 *
 * @param {{ templateRoot?: string }} [options]
 * @returns {Promise<Array<{ slug: string, label: string, domain: string, src: string, alt: string, shape: LogoShape, source?: "upload" }>>}
 */
export async function readResolvedMarks({ templateRoot } = {}) {
  const root = templateRoot || getBrandLogosTemplateRoot();
  const manifestPath = join(root, "logos.json");
  if (!existsSync(manifestPath)) return [];
  /** @type {LogoManifest} */
  let manifest;
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest = parsed && Array.isArray(parsed.logos) ? parsed : { logos: [] };
  } catch {
    return [];
  }
  /** @type {Array<{ slug: string, label: string, domain: string, src: string, alt: string, shape: LogoShape, source?: "upload" }>} */
  const marks = [];
  for (const entry of manifest.logos) {
    const slug = String(entry && entry.slug ? entry.slug : "").trim();
    if (!isValidSlug(slug)) continue;
    const assetPath = join(root, "assets", `logo-${slug}.png`);
    if (!existsSync(assetPath)) continue;
    const data = await readFile(assetPath);
    if (!looksLikeImage(data)) continue;
    const label = String(entry.label || slug);
    /** @type {{ slug: string, label: string, domain: string, src: string, alt: string, shape: LogoShape, source?: "upload" }} */
    const mark = {
      slug,
      label,
      domain: entry.domain ? String(entry.domain) : "",
      src: `data:${imageMime(data)};base64,${data.toString("base64")}`,
      alt: `${label} logo`,
      shape: logoShape(data, entry.shape),
    };
    if (existsSync(join(root, "uploads", `logo-${slug}.png`))) mark.source = "upload";
    marks.push(mark);
  }
  return marks;
}

/** @param {unknown} raw */
function normalizeDomain(raw) {
  let value = String(raw || "").trim();
  if (!value) return "";
  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  value = value.split(/[/?#]/)[0].trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? value : "";
}

/** @param {unknown} value */
function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}

/**
 * @param {unknown} value
 * @param {unknown} slug
 */
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

/**
 * @param {Record<string, unknown>} source
 * @returns {unknown[]}
 */
function getProfileLogoCollections(source) {
  return /** @type {unknown[]} */ ([])
    .concat(Array.isArray(source.experiences) ? source.experiences : [])
    .concat(Array.isArray(source.projects) ? source.projects : [])
    .concat(Array.isArray(source.workHistory) ? source.workHistory : [])
    .concat(Array.isArray(source.portfolio) ? source.portfolio : [])
    .concat(Array.isArray(source.caseStudies) ? source.caseStudies : []);
}

/**
 * @param {unknown} profile
 * @param {LogoManifest | null} [priorManifest]
 * @returns {LogoManifest}
 */
export function buildLogoManifestFromProfile(profile, priorManifest = null) {
  const source = /** @type {Record<string, unknown>} */ (
    profile && typeof profile === "object" ? profile : {}
  );
  /** @type {Map<string, LogoEntry>} */
  const priorBySlug = new Map();
  if (priorManifest && Array.isArray(priorManifest.logos)) {
    priorManifest.logos.forEach((entry) => {
      if (entry && isValidSlug(entry.slug)) priorBySlug.set(entry.slug, entry);
    });
  }
  const collections = getProfileLogoCollections(source);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {LogoEntry[]} */
  const logos = [];

  collections.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (item);
    const label =
      String(record.label || record.company || record.name || record.title || "").trim();
    const slug = isValidSlug(record.slug) ? String(record.slug) : slugify(label);
    if (!slug || !isValidSlug(slug) || seen.has(slug)) return;
    seen.add(slug);
    /** @type {LogoEntry} */
    const entry = { slug, label: label || slug };
    const domain = normalizeDomain(record.logoDomain || record.domain || record.website);
    if (domain) entry.domain = domain;
    const prior = priorBySlug.get(slug) || null;
    const upload =
      normalizeLogoUpload(record.logoUpload, slug) ||
      (prior && typeof prior.upload === "string" ? prior.upload : "");
    if (upload) entry.upload = upload;
    const declaredShape = record.logoShape || (prior && prior.shape);
    if (declaredShape === "mark" || declaredShape === "wordmark" || declaredShape === "lockup") {
      entry.shape = declaredShape;
    }
    logos.push(entry);
  });

  return {
    $comment:
      "Generated from ~/.jobbored/profile.json experiences/projects. Resolved by scripts/logo_resolver.py into assets/logo-<slug>.png.",
    logos,
  };
}

/**
 * @param {unknown} profile
 * @param {{ templateRoot?: string }} [options]
 */
export async function writeLogoManifestFromProfile(profile, { templateRoot } = {}) {
  const root = await resolveTemplateRoot(templateRoot || getBrandLogosTemplateRoot());
  const priorManifest = await readManifest(root);
  const manifest = buildLogoManifestFromProfile(profile, priorManifest);
  await writeJsonAtomic(await safeTemplatePath(root, "logos.json", { ensureParent: true }), manifest);
  return { templateRoot: root, manifest };
}

/**
 * @param {unknown} profile
 * @param {{ templateRoot?: string }} [options]
 */
export async function refreshLogosFromProfile(profile, options = {}) {
  const written = await writeLogoManifestFromProfile(profile, options);
  const resolved = await runResolver({
    force: false,
    templateRoot: written.templateRoot,
  });
  return { ...written, resolved };
}

/**
 * @param {unknown} slug
 * @param {Buffer | Uint8Array | string | number[]} buffer
 * @param {{ templateRoot?: string }} [options]
 */
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

/** @param {{ templateRoot?: string }} [options] */
export async function listLogos({ templateRoot } = {}) {
  const root = await resolveTemplateRoot(templateRoot || getBrandLogosTemplateRoot());
  const manifest = await readManifest(root);
  /** @type {Array<{ slug: string, label: string, domain: string, upload: string, source: string, shape: LogoShape, mark: { path: string, mime: string, dataUrl: string } | null }>} */
  const logos = [];
  for (const entry of manifest.logos) {
    const slug = String(entry && entry.slug ? entry.slug : "").trim();
    if (!isValidSlug(slug)) continue;
    const assetPath = await safeTemplatePath(root, join("assets", `logo-${slug}.png`), {
      ensureParent: true,
    });
    let mark = null;
    /** @type {LogoShape} */
    let shape = logoShape(Buffer.alloc(0), entry.shape);
    if (existsSync(assetPath)) {
      const data = await readFile(assetPath);
      shape = logoShape(data, entry.shape);
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
      shape,
      mark,
    });
  }
  return { templateRoot: root, logos };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {{ maxBytes?: number }} [options]
 */
export async function parseMultipartFile(req, { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw makeError("Expected multipart/form-data", 400);
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  for await (const rawChunk of req) {
    const chunk = /** @type {Buffer} */ (rawChunk);
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

/** @param {unknown} filename */
export function assertAllowedUploadName(filename) {
  const ext = extname(String(filename || "").toLowerCase());
  if (!BRAND_LOGO_LIMITS.allowedExtensions.includes(ext)) {
    throw makeError("Upload must be png, jpg, svg, or webp", 400);
  }
}
