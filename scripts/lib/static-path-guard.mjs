import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const DEFAULT_LISTEN_HOST = "127.0.0.1";
export const LISTEN_HOST_ENV = "COMMAND_CENTER_LISTEN_HOST";

const DENIED_BASENAMES = new Set([
  "config.js",
  "discovery-local-bootstrap.json",
  "service-account-key.json",
  "brief-mockup.html",
]);

const DENIED_PATHS = new Set([
  "integrations/browser-use-discovery/worker.log",
  "integrations/hermes-job-hunt/profile/profile.md",
  "integrations/hermes-job-hunt/profile/voice.md",
  "integrations/hermes-job-hunt/profile/resume-bullets.md",
  "integrations/hermes-job-hunt/profile/job-preferences.md",
  "integrations/hermes-job-hunt/profile/materials-quality.md",
  "integrations/hermes-job-hunt/profile/merge_report.md",
  "integrations/hermes-job-hunt/profile/profile-sources-needed.md",
]);

const DENIED_PATH_PREFIXES = [
  "integrations/browser-use-discovery/state",
  "integrations/hermes-job-hunt/applications",
  "integrations/hermes-job-hunt/state",
  "integrations/hermes-job-hunt/evidence",
  "integrations/hermes-job-hunt/profile/sources",
];

// BEAUDIT G3: the dev-server serves an allowlist. A denylist over the whole
// repo leaked gitignored local artifacts (tmp/*.log, docs/redesign/logs,
// uploads/, profile zips) and server source.
const ROOT_FILE_EXTENSIONS = new Set([
  ".html", ".js", ".css", ".svg", ".png", ".ico", ".webp", ".jpg", ".jpeg",
  ".gif", ".woff", ".woff2", ".webmanifest", ".txt",
]);

const PUBLIC_DIRECTORIES = [
  "assets",
  "css",
  "partials",
  "vendor",
  "lib",
  "fixtures",
  "schemas",
  "examples",
  "integrations/apps-script",
];

const PUBLIC_DOC_EXTENSIONS = new Set([
  ".md", ".png", ".svg", ".webp", ".jpg", ".jpeg", ".gif",
]);

const DENIED_ANYWHERE_EXTENSIONS = new Set([
  ".log", ".zip", ".env", ".pem", ".key", ".sqlite", ".db",
]);

// Root documents the dashboard links to (the discovery drawer links the
// public webhook contract). Named one by one, not every root .md.
const PUBLIC_ROOT_DOCUMENTS = new Set(["AGENT_CONTRACT.md"]);

// Single files outside the public directories that the dashboard loads
// as classic scripts. Named one by one — server/ as a whole stays dark
// (BEAUDIT G3); only the Fit Profile share (consumed by B3's serverless
// fallback) is public.
const PUBLIC_FILES = new Set(["server/profile-draft-shared.js"]);

function extensionOf(segment) {
  const index = segment.lastIndexOf(".");
  return index > 0 ? segment.slice(index).toLowerCase() : "";
}

/**
 * True only for the dashboard's public files: root web assets, the public
 * asset directories, named single files, markdown docs, and the
 * integration READMEs the wizard links to. Everything else under the repo
 * root is refused.
 */
export function isServableRelativePath(relativePath) {
  const segments = posixSegments(relativePath);
  if (segments.length === 0) return false;
  if (isDeniedRelativePath(relativePath)) return false;
  const joined = segments.join("/");
  const lower = joined.toLowerCase();
  const ext = extensionOf(segments[segments.length - 1]);
  if (DENIED_ANYWHERE_EXTENSIONS.has(ext)) return false;
  if (segments.some((segment) => segment.toLowerCase() === "uploads")) return false;
  if (PUBLIC_FILES.has(joined)) return true;
  if (segments.length === 1) {
    return ROOT_FILE_EXTENSIONS.has(ext) || PUBLIC_ROOT_DOCUMENTS.has(joined);
  }
  if (PUBLIC_DIRECTORIES.some((dir) => lower.startsWith(`${dir}/`))) return true;
  if (segments[0] === "docs") {
    return PUBLIC_DOC_EXTENSIONS.has(ext) && !lower.startsWith("docs/redesign/logs/");
  }
  if (segments[0] === "integrations") return ext === ".md";
  return false;
}

/**
 * Loopback by default. Remote bind only when `host` or COMMAND_CENTER_LISTEN_HOST
 * is set explicitly (for example `0.0.0.0`).
 */
export function resolveListenHost({ host, env = process.env } = {}) {
  const fromHost = host == null ? "" : String(host).trim();
  if (fromHost) return fromHost;
  const fromEnv = String(env?.[LISTEN_HOST_ENV] || "").trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_LISTEN_HOST;
}

export function parseRequestUrl(reqUrl, origin) {
  const raw = String(reqUrl || "/");
  if (raw.includes("\0") || /%00/i.test(raw)) {
    return { ok: false, status: 403, reason: "null_byte" };
  }
  try {
    return { ok: true, url: new URL(raw, origin) };
  } catch {
    return { ok: false, status: 400, reason: "malformed_uri" };
  }
}

export function decodeRequestPathname(pathname) {
  try {
    const decoded = decodeURIComponent(String(pathname ?? ""));
    if (decoded.includes("\0")) {
      return { ok: false, status: 403, reason: "null_byte" };
    }
    return { ok: true, pathname: decoded };
  } catch {
    return { ok: false, status: 400, reason: "malformed_uri" };
  }
}

function posixSegments(relativePath) {
  return String(relativePath || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".");
}

export function isDeniedRelativePath(relativePath) {
  const segments = posixSegments(relativePath);
  if (segments.some((segment) => segment.startsWith("."))) return true;
  if (segments.some((segment) => DENIED_BASENAMES.has(segment))) return true;
  const joined = segments.join("/").toLowerCase();
  if (DENIED_PATHS.has(joined)) return true;
  return DENIED_PATH_PREFIXES.some(
    (prefix) => joined === prefix || joined.startsWith(`${prefix}/`),
  );
}

function isInsideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function splitUrlPath(urlPath) {
  const raw = String(urlPath || "/").split("?")[0].split("#")[0];
  if (raw.includes("\0")) {
    return { ok: false, status: 403, reason: "null_byte" };
  }
  const parts = [];
  for (const segment of raw.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) {
        return { ok: false, status: 403, reason: "path_escape" };
      }
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (parts.length === 0) {
    return { ok: true, relativePath: "index.html" };
  }
  return { ok: true, relativePath: parts.join("/") };
}

/**
 * Resolve a decoded URL path to a file under `root`. Callers must invoke
 * HTML include expansion only after this returns ok (F4-D expand-after-containment).
 */
export async function resolvePublicFile(urlPath, { root } = {}) {
  if (!root) {
    return { ok: false, status: 500, reason: "missing_root" };
  }

  const split = splitUrlPath(urlPath);
  if (!split.ok) return split;
  if (isDeniedRelativePath(split.relativePath)) {
    return { ok: false, status: 403, reason: "denied_artifact" };
  }
  const directoryRequest = !extensionOf(
    posixSegments(split.relativePath).slice(-1)[0] || "",
  );
  if (!directoryRequest && !isServableRelativePath(split.relativePath)) {
    return { ok: false, status: 404, reason: "not_public" };
  }

  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, split.relativePath);
  if (!isInsideRoot(rootResolved, candidate)) {
    return { ok: false, status: 403, reason: "path_escape" };
  }

  let rootReal;
  try {
    rootReal = await realpath(rootResolved);
  } catch {
    return { ok: false, status: 404, reason: "missing" };
  }

  let target = candidate;
  let info;
  try {
    info = await stat(target);
  } catch {
    return { ok: false, status: 404, reason: "missing" };
  }

  if (info.isDirectory()) {
    target = join(target, "index.html");
    const nestedRelative = relative(rootResolved, target).replaceAll("\\", "/");
    if (isDeniedRelativePath(nestedRelative)) {
      return { ok: false, status: 403, reason: "denied_artifact" };
    }
    try {
      info = await stat(target);
    } catch {
      return { ok: false, status: 404, reason: "missing" };
    }
    if (info.isDirectory()) {
      return { ok: false, status: 404, reason: "missing" };
    }
  }

  let realFile;
  try {
    realFile = await realpath(target);
  } catch {
    return { ok: false, status: 404, reason: "missing" };
  }

  if (!isInsideRoot(rootReal, realFile)) {
    return { ok: false, status: 403, reason: "path_escape" };
  }

  const servedRelative = relative(rootReal, realFile).replaceAll("\\", "/");
  if (isDeniedRelativePath(servedRelative)) {
    return { ok: false, status: 403, reason: "denied_artifact" };
  }
  if (!isServableRelativePath(servedRelative)) {
    return { ok: false, status: 404, reason: "not_public" };
  }

  return { ok: true, status: 200, filePath: realFile };
}
