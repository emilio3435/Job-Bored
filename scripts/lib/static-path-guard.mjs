import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const DEFAULT_LISTEN_HOST = "127.0.0.1";
export const LISTEN_HOST_ENV = "COMMAND_CENTER_LISTEN_HOST";

const DENIED_BASENAMES = new Set([
  "config.js",
  "discovery-local-bootstrap.json",
]);

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
  const joined = segments.join("/");
  return (
    joined === "integrations/browser-use-discovery/state" ||
    joined.startsWith("integrations/browser-use-discovery/state/")
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

  return { ok: true, status: 200, filePath: realFile };
}
