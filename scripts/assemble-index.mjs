#!/usr/bin/env node
/**
 * Assemble index.html includes into one HTML document.
 *
 * index.html on disk stays small; the local dashboard server expands at
 * read time. Static hosts that cannot expand includes should serve the
 * `--write` output. F0-A owns HTTP path containment; this assembler
 * expands only after a contained include resolver keeps targets inside
 * the repo root.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createContainedIncludeResolver,
  expandIndexIncludes,
} from "./lib/expand-index-includes.mjs";
import { missingProtectedIds } from "./lib/index-protected-surface.mjs";

export function assembleIndex(repoRoot, options = {}) {
  const indexPath = join(repoRoot, "index.html");
  const template = readFileSync(indexPath, "utf8");
  const resolveIncludePath =
    options.resolveIncludePath || createContainedIncludeResolver(repoRoot);
  return expandIndexIncludes(template, repoRoot, 0, {
    ...options,
    resolveIncludePath,
  });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function runCli() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const assembled = assembleIndex(repoRoot);
  const missing = missingProtectedIds(assembled);
  if (missing.length) {
    console.error(
      `assemble-index: protected surface missing ids: ${missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  const outPath = process.argv.includes("--write")
    ? join(repoRoot, "index.assembled.html")
    : null;
  if (outPath) {
    writeFileSync(outPath, assembled, "utf8");
    console.log(
      `assemble-index: wrote ${outPath} (${assembled.split("\n").length} lines)`,
    );
    return;
  }
  const lineCount = assembled.split("\n").length;
  console.log(`assemble-index: index.html expands to ${lineCount} lines`);
}

if (isMainModule()) {
  runCli();
}
