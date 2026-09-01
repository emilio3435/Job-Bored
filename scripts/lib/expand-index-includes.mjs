import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const INCLUDE_RE = /<!--\s*@include\s+([^\s>]+)\s*-->/g;

function defaultResolveIncludePath(relPath, fromDir) {
  return resolve(fromDir, relPath);
}

/**
 * Assembler-side include resolver. Keeps `<!-- @include -->` targets inside
 * `rootDir` after realpath. This is NOT the F0-A HTTP deny list — F0-A must
 * still realpath/deny the request path, then call expand with a contained
 * resolver (this helper or a stricter one).
 */
export function createContainedIncludeResolver(rootDir) {
  const root = resolve(rootDir);
  return function resolveIncludePath(relPath, fromDir) {
    if (typeof relPath !== "string" || !relPath.trim()) {
      throw new Error("Include path missing");
    }
    if (relPath.includes("\0")) {
      throw new Error("Include path contains NUL");
    }
    const resolved = resolve(fromDir, relPath);
    let candidate = resolved;
    try {
      candidate = realpathSync(resolved);
    } catch {
      candidate = resolved;
    }
    const rel = relative(root, candidate);
    if (rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`Include path escapes assembly root: ${relPath}`);
    }
    return resolved;
  };
}

/**
 * Expand `<!-- @include rel/path -->` markers.
 *
 * F0-A integration: contain the served HTML path first, then call this with
 * `options.resolveIncludePath` that realpath/denies include targets. Default
 * resolution is `path.resolve(fromDir, relPath)` so existing callers keep
 * their current semantics unless they opt into a contained resolver.
 */
export function expandIndexIncludes(source, baseDir, depth = 0, options = {}) {
  let depthValue = depth;
  let opts = options;
  if (depth && typeof depth === "object") {
    opts = depth;
    depthValue = 0;
  }
  if (depthValue > 8) {
    throw new Error("Include depth exceeded (possible cycle)");
  }
  const resolveIncludePath =
    typeof opts.resolveIncludePath === "function"
      ? opts.resolveIncludePath
      : defaultResolveIncludePath;
  INCLUDE_RE.lastIndex = 0;
  return source.replace(INCLUDE_RE, (_match, relPath) => {
    const partialPath = resolveIncludePath(relPath, baseDir, opts);
    const partial = readFileSync(partialPath, "utf8");
    return expandIndexIncludes(partial, dirname(partialPath), depthValue + 1, opts);
  });
}

export function readIndexHtml(
  repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  options = {},
) {
  const indexPath = join(repoRoot, "index.html");
  const source = readFileSync(indexPath, "utf8");
  if (!INCLUDE_RE.test(source)) {
    return source;
  }
  INCLUDE_RE.lastIndex = 0;
  const resolveIncludePath =
    options.resolveIncludePath || createContainedIncludeResolver(repoRoot);
  return expandIndexIncludes(source, repoRoot, 0, { ...options, resolveIncludePath });
}
