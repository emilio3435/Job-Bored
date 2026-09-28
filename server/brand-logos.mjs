/**
 * Brand logo bridge for resume and letter logo marks.
 *
 * The user's logos live under ~/.jobbored/logos (see
 * getBrandLogosTemplateRoot); the repo's resume-template folder is only a
 * read-only sample.
 *
 * The Python resolver owns the actual upload/favicon/monogram resolution.
 * This module keeps the Express surface small: validate uploads, write the
 * profile-derived manifest, spawn the resolver, and report current marks.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  readFile,
  writeFile,
  rename,
  stat,
  unlink,
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
import { companyDisplayName, companyDomainHint, companyKey } from "./materials-monogram.mjs";

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

/**
 * The repo's integrations/hermes-job-hunt/resume-template/ is a read-only
 * sample (its logos are the maintainer's). Uploads and resolved marks never
 * go there.
 */
export function getRepoSampleTemplateRoot() {
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

/** @param {string} raw */
function expandHome(raw) {
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return join(homedir(), raw.slice(2));
  return resolvePath(raw);
}

/**
 * Where the user's logo uploads, logos.json and resolved marks live:
 *   1. JOBBORED_LOGOS_DIR (absolute)
 *   2. an explicit Hermes template root (HERMES_RESUME_TEMPLATE_DIR,
 *      HERMES_JOB_HUNT_ROOT, HERMES_ROOT), for the Hermes integration
 *   3. <JOBBORED_HOME>/logos, default ~/.jobbored/logos
 * Never the repo: getRepoSampleTemplateRoot() is a read-only sample.
 */
export function getBrandLogosTemplateRoot() {
  const logosDir = requireAbsoluteEnvPath("JOBBORED_LOGOS_DIR", process.env.JOBBORED_LOGOS_DIR);
  if (logosDir) return logosDir;

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

  const home = String(process.env.JOBBORED_HOME || "").trim();
  return join(home ? expandHome(home) : join(homedir(), ".jobbored"), "logos");
}

/**
 * Refuse to write logo state into the repo's sample folder.
 * @param {string} root
 */
function assertNotRepoSample(root) {
  const sample = resolvePath(getRepoSampleTemplateRoot());
  const target = resolvePath(root);
  if (target === sample || target.startsWith(`${sample}/`)) {
    throw makeError("Logo uploads never write into the repo's sample template; set JOBBORED_LOGOS_DIR or JOBBORED_HOME.", 500);
  }
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
/**
 * @param {string} message
 * @param {number} statusCode
 * @param {string} [code]
 */
function makeError(message, statusCode, code) {
  const err = /** @type {Error & { statusCode: number, code?: string, retryable?: boolean }} */ (new Error(message));
  err.statusCode = statusCode;
  if (code) err.code = code;
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
  assertNotRepoSample(templateRoot);
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

/** @type {boolean | null} */
let developerToolsPresent = null;

/** `xcode-select -p` answers without the install dialog `python3` would pop. */
function probeDeveloperToolsOnce() {
  if (developerToolsPresent === null) {
    const result = spawnSync("/usr/bin/xcode-select", ["-p"], {
      stdio: "ignore",
      timeout: 5_000,
    });
    developerToolsPresent = result.status === 0;
  }
  return developerToolsPresent;
}

/**
 * GFX blocker 3: on a Mac without the Command Line Tools, /usr/bin/python3 is
 * a shim that pops Apple's "Install developer tools" dialog, and the resolver
 * runs on every profile save. Skip it under the desktop app, when
 * `xcode-select -p` fails, or when JOBBORED_LOGO_RESOLVER=off.
 *
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, probeDeveloperTools?: () => boolean }} [options]
 * @returns {{ enabled: boolean, reason: "" | "disabled" | "desktop" | "developer_tools_missing" }}
 */
export function logoResolverGate({
  env = process.env,
  platform = process.platform,
  probeDeveloperTools = probeDeveloperToolsOnce,
} = {}) {
  if (String(env.JOBBORED_LOGO_RESOLVER || "").trim().toLowerCase() === "off") {
    return { enabled: false, reason: "disabled" };
  }
  if (String(env.JOBBORED_DESKTOP || "").trim() === "1") {
    return { enabled: false, reason: "desktop" };
  }
  if (platform === "darwin" && !probeDeveloperTools()) {
    return { enabled: false, reason: "developer_tools_missing" };
  }
  return { enabled: true, reason: "" };
}

/**
 * Without the Python resolver: an uploaded logo still becomes the mark;
 * every other entry is left to the renderer's monogram.
 *
 * @param {string} root
 * @param {LogoManifest} manifest
 * @param {{ force: boolean, reason: string }} options
 * @returns {Promise<ResolverRow[]>}
 */
async function resolveWithoutPython(root, manifest, { force, reason }) {
  /** @type {ResolverRow[]} */
  const rows = [];
  for (const entry of manifest.logos) {
    const slug = String(entry && entry.slug ? entry.slug : "").trim();
    if (!isValidSlug(slug)) continue;
    const uploadPath = entry.upload
      ? await safeTemplatePath(root, String(entry.upload))
      : "";
    const upload = uploadPath && existsSync(uploadPath) ? await readFile(uploadPath) : null;
    if (upload && looksLikeImage(upload)) {
      const assetPath = await safeTemplatePath(root, join("assets", `logo-${slug}.png`), {
        ensureParent: true,
      });
      if (force || !existsSync(assetPath)) await writeFileAtomic(assetPath, upload);
      rows.push({ slug, source: "upload", detail: `logo resolver skipped (${reason})` });
      continue;
    }
    rows.push({ slug, source: "monogram", detail: `logo resolver skipped (${reason})` });
  }
  return rows;
}

/**
 * @param {{ force?: boolean, templateRoot?: string, env?: NodeJS.ProcessEnv, platform?: string, probeDeveloperTools?: () => boolean }} [options]
 * @returns {Promise<ResolverRow[]>}
 */
export async function runResolver({
  force = false,
  templateRoot,
  env,
  platform,
  probeDeveloperTools,
} = {}) {
  const root = await resolveTemplateRoot(templateRoot || getBrandLogosTemplateRoot());
  const manifest = await readManifest(root);
  if (!manifest.logos.length) return [];

  const gate = logoResolverGate({ env, platform, probeDeveloperTools });
  if (!gate.enabled) return resolveWithoutPython(root, manifest, { force, reason: gate.reason });

  const script = getLogoResolverScript();
  // BEAUDIT G15/E5: the resolver script lives outside the server-only Docker
  // context — when it is absent, resolution is unavailable, not a failure.
  if (!existsSync(script)) {
    const unavailable = makeError(
      "Logo resolution is unavailable on this host (resolver script missing).",
      501,
      "logos_unavailable",
    );
    unavailable.retryable = false;
    throw unavailable;
  }
  const args = [script, "--template-dir", root];
  if (force) args.push("--force");
  return spawnResolver(args, DEFAULT_TIMEOUT_MS);
}

/**
 * Run logo_resolver.py and parse its report.
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<ResolverRow[]>}
 */
function spawnResolver(args, timeoutMs) {
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
    }, timeoutMs);

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

/**
 * An SVG document: `<svg` first, or after an XML prolog, comments or a
 * doctype (sites often serve `<?xml …?>` first, as logo_resolver.py accepts).
 * @param {Buffer} buffer
 */
function isSvg(buffer) {
  const head = buffer.subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  const body = head.replace(/^(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|\s)*/i, "");
  return /^<svg[\s>]/i.test(body);
}

/** @param {Buffer | Uint8Array | string | number[] | null | undefined} data */
export function looksLikeImage(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  if (buffer.length < 16) return false;
  if (buffer.subarray(8, 12).equals(Buffer.from("WEBP"))) return true;
  if (isSvg(buffer)) return true;
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
  if (isSvg(buffer)) return "image/svg+xml";
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

/* ------------------------------------------------------------------ *
 * Target company marks (the company a package is addressed to)
 * ------------------------------------------------------------------ */

const TARGET_DIR = "targets";
const TARGET_TIMEOUT_MS = 25_000;
const TARGET_MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/* A company whose resume line names its domain is retried after a day: the
 * hint makes a later lookup likely to land, and the miss may predate it. */
const TARGET_MISS_RETRY_DOMAIN_MS = 24 * 60 * 60 * 1000;
const MISS_FILE_RE = /^\.miss-[a-z0-9][a-z0-9-]*$/;

/**
 * Whether a recorded miss still blocks a lookup. A miss is written as JSON
 * ({ at, key, domain }); one recorded without the domain this lookup now
 * has (an older miss, or a miss under an older key shape) never blocks.
 * @param {string} path
 * @param {{ nowMs: number, domain: string }} input
 */
async function missBlocks(path, { nowMs, domain }) {
  if (!existsSync(path)) return false;
  let recordedDomain = null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.domain === "string") recordedDomain = parsed.domain;
  } catch {
    recordedDomain = null;
  }
  if (domain && recordedDomain !== domain) return false;
  const retryMs = domain ? TARGET_MISS_RETRY_DOMAIN_MS : TARGET_MISS_RETRY_MS;
  return nowMs - (await stat(path)).mtimeMs < retryMs;
}

/**
 * Clear recorded logo misses so the next draft looks those companies up
 * again. Removes only `.miss-<key>` files directly under <logos>/targets —
 * never an asset, an upload or logos.json. By default it clears misses in
 * the old plain-timestamp format (written before misses recorded their
 * domain); `before` also clears any miss last written before that time.
 *
 * @param {{ templateRoot?: string, before?: Date | null, dryRun?: boolean }} [options]
 * @returns {Promise<{ dir: string, removed: string[], kept: string[] }>}
 */
export async function clearStaleLogoMisses(options = {}) {
  const root = options.templateRoot || getBrandLogosTemplateRoot();
  const dir = join(root, TARGET_DIR);
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const kept = [];
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return { dir, removed, kept };
  }
  const beforeMs = options.before instanceof Date ? options.before.getTime() : NaN;
  for (const name of names.sort()) {
    if (!MISS_FILE_RE.test(name)) continue;
    const path = join(dir, name);
    const info = await lstat(path).catch(() => null);
    if (!info || !info.isFile()) continue;
    let legacy = true;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      legacy = !(parsed && typeof parsed === "object" && typeof parsed.at === "string");
    } catch {
      legacy = true;
    }
    const old = Number.isFinite(beforeMs) && info.mtimeMs < beforeMs;
    if (!legacy && !old) {
      kept.push(name);
      continue;
    }
    if (!options.dryRun) await unlink(path);
    removed.push(name);
  }
  return { dir, removed, kept };
}

/**
 * The cache slug for a target company: its name without a legal suffix
 * ("NorthwindMedia, Inc." → "northwindmedia").
 * @param {unknown} company
 */
export function targetSlug(company) {
  return companyKey(company);
}

/**
 * The cached mark for a target company, read-only and offline: the file the
 * resolver wrote under <logos>/targets/assets, or null.
 *
 * @param {unknown} company
 * @param {{ templateRoot?: string }} [options]
 * @returns {Promise<{ src: string, alt: string, shape: LogoShape, company: string } | null>}
 */
export async function readTargetMark(company, { templateRoot } = {}) {
  const slug = targetSlug(company);
  if (!isValidSlug(slug)) return null;
  const root = templateRoot || getBrandLogosTemplateRoot();
  const assetPath = join(root, TARGET_DIR, "assets", `logo-${slug}.png`);
  if (!existsSync(assetPath)) return null;
  const data = await readFile(assetPath);
  if (!looksLikeImage(data)) return null;
  return {
    src: `data:${imageMime(data)};base64,${data.toString("base64")}`,
    alt: `${String(company).trim()} logo`,
    shape: logoShape(data),
    /* The company this file was resolved for; renderPackage prints the
       mark only for an addressee with the same key. */
    company: String(company).trim(),
  };
}

/**
 * The target company's mark for a render: the cache, else one resolver run
 * (site logo, Wikidata, favicon; see logo_resolver.py) bounded by a timeout,
 * else null, and the renderer draws a monogram. A company that resolved to
 * nothing is not retried for a week. Never throws: a logo must never fail a
 * draft.
 *
 * @param {unknown} company
 * @param {{ domain?: string, templateRoot?: string, env?: NodeJS.ProcessEnv, platform?: string, probeDeveloperTools?: () => boolean, timeoutMs?: number, nowMs?: number }} [options]
 * @returns {Promise<{ src: string, alt: string, shape: LogoShape, company: string } | null>}
 */
export async function loadTargetMark(company, options = {}) {
  return loadCompanyMark(company, options);
}

/**
 * @typedef {(job: { dir: string, slug: string, label: string, domain: string, timeoutMs: number }) => Promise<ResolverRow[]>} CompanyResolver
 *   Resolves one company's mark into <dir>/assets/logo-<slug>.png (the
 *   default runs logo_resolver.py: site logo, Wikidata, favicon). Tests pass
 *   a stub, so no test touches the network.
 */

/**
 * Any company's mark (the addressee, or an employer on the resume): the
 * cache under <logos>/targets, else one resolver run bounded by a timeout,
 * else null, and the renderer draws a monogram. The cache is keyed by the
 * company's own name (companyKey: no legal suffix, parenthetical or
 * "formerly" clause); a domain the resume gives in a parenthetical is the
 * lookup hint, else the resolver's name-to-domain lookup. A company that
 * resolved to nothing is not retried for a week, or a day when its line
 * names a domain; a miss recorded without that domain never blocks. Never
 * throws: a logo must never fail a draft.
 *
 * @param {unknown} company
 * @param {{ domain?: string, templateRoot?: string, env?: NodeJS.ProcessEnv, platform?: string, probeDeveloperTools?: () => boolean, timeoutMs?: number, nowMs?: number, resolve?: CompanyResolver }} [options]
 * @returns {Promise<{ src: string, alt: string, shape: LogoShape, company: string, source?: string } | null>}
 */
export async function loadCompanyMark(company, options = {}) {
  try {
    const slug = targetSlug(company);
    if (!isValidSlug(slug)) return null;
    const root = options.templateRoot || getBrandLogosTemplateRoot();
    const cached = await readTargetMark(company, { templateRoot: root });
    if (cached) return cached;

    const script = getLogoResolverScript();
    if (!options.resolve) {
      const gate = logoResolverGate({ env: options.env, platform: options.platform, probeDeveloperTools: options.probeDeveloperTools });
      if (!gate.enabled || !existsSync(script)) return null;
    }
    assertNotRepoSample(root);
    const dir = join(root, TARGET_DIR);
    await mkdir(dir, { recursive: true });
    const miss = join(dir, `.miss-${slug}`);
    const now = options.nowMs ?? Date.now();
    const label = companyDisplayName(company) || String(company).trim();
    const domain = normalizeDomain(options.domain) || companyDomainHint(company);
    if (await missBlocks(miss, { nowMs: now, domain })) return null;

    const timeoutMs = options.timeoutMs ?? TARGET_TIMEOUT_MS;
    const resolve = options.resolve || ((/** @type {{ dir: string, slug: string, label: string, domain: string, timeoutMs: number }} */ job) => {
      const args = [script, "--template-dir", job.dir, "--slug", job.slug, "--label", job.label];
      if (job.domain) args.push("--domain", job.domain);
      return spawnResolver(args, job.timeoutMs);
    });
    const rows = await resolve({ dir, slug, label, domain, timeoutMs });
    const found = await readTargetMark(company, { templateRoot: root });
    if (!found && rows.some((r) => r.slug === slug && r.source === "missing")) {
      await writeFile(miss, `${JSON.stringify({ at: new Date(now).toISOString(), key: slug, domain })}\n`, "utf8");
    }
    return found;
  } catch {
    return null;
  }
}

const EMPLOYER_CONCURRENCY = 3;
const EMPLOYER_TIMEOUT_MS = 20_000;
const EMPLOYER_BUDGET_MS = 60_000;

/**
 * Marks for every employer on a resume, for the renderer's `marks`: each
 * company from the cache, else one bounded resolver run (loadCompanyMark),
 * a few at a time, within an overall budget; companies not reached in time
 * are skipped and get a monogram. The monogram is only ever the last resort
 * once every source failed. Never throws.
 *
 * @param {unknown[]} companies employer names as the resume writes them
 * @param {{ templateRoot?: string, env?: NodeJS.ProcessEnv, platform?: string, probeDeveloperTools?: () => boolean, timeoutMs?: number, budgetMs?: number, resolve?: CompanyResolver, nowMs?: number }} [options]
 * @returns {Promise<Array<{ slug: string, label: string, domain: string, src: string, alt: string, shape: LogoShape, source?: "upload" }>>}
 */
export async function loadEmployerMarks(companies, options = {}) {
  const seen = new Set();
  /** @type {string[]} */
  const names = [];
  for (const raw of Array.isArray(companies) ? companies : []) {
    const name = String(raw || "").trim();
    const key = companyKey(name);
    if (!name || !isValidSlug(key) || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  const deadline = Date.now() + (options.budgetMs ?? EMPLOYER_BUDGET_MS);
  /** @type {Array<{ slug: string, label: string, domain: string, src: string, alt: string, shape: LogoShape }>} */
  const marks = [];
  let next = 0;
  async function worker() {
    while (next < names.length) {
      const name = names[next];
      next += 1;
      const remaining = deadline - Date.now();
      /* Past the budget: only the cache, never a new network run. */
      const mark = remaining > 1000
        ? await loadCompanyMark(name, { ...options, timeoutMs: Math.min(options.timeoutMs ?? EMPLOYER_TIMEOUT_MS, remaining) })
        : await readTargetMark(name, { templateRoot: options.templateRoot }).catch(() => null);
      if (mark) {
        const label = companyDisplayName(name) || name;
        marks.push({ slug: companyKey(name), label, domain: companyDomainHint(name), src: mark.src, alt: `${label} logo`, shape: mark.shape });
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(EMPLOYER_CONCURRENCY, names.length) }, worker));
  } catch {
    /* a logo never fails a draft */
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
