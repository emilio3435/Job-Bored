import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INCLUDE_RE = /<!--\s*@include\s+([^\s>]+)\s*-->/g;

export function expandIndexIncludes(source, baseDir, depth = 0) {
  if (depth > 8) {
    throw new Error("Include depth exceeded (possible cycle)");
  }
  return source.replace(INCLUDE_RE, (_match, relPath) => {
    const partialPath = resolve(baseDir, relPath);
    const partial = readFileSync(partialPath, "utf8");
    return expandIndexIncludes(partial, dirname(partialPath), depth + 1);
  });
}

export function readIndexHtml(repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")) {
  const indexPath = join(repoRoot, "index.html");
  const source = readFileSync(indexPath, "utf8");
  if (!INCLUDE_RE.test(source)) {
    return source;
  }
  INCLUDE_RE.lastIndex = 0;
  return expandIndexIncludes(source, repoRoot);
}
