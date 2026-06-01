#!/usr/bin/env node
/**
 * Verify index.html includes expand cleanly (optional CI check).
 * index.html on disk stays small; dev-server and tests expand at read time.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandIndexIncludes } from "./lib/expand-index-includes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(repoRoot, "index.html");
const template = readFileSync(indexPath, "utf8");
const assembled = expandIndexIncludes(template, repoRoot);

const outPath = process.argv.includes("--write")
  ? join(repoRoot, "index.assembled.html")
  : null;
if (outPath) {
  writeFileSync(outPath, assembled, "utf8");
  console.log(`assemble-index: wrote ${outPath} (${assembled.split("\n").length} lines)`);
} else {
  const lineCount = assembled.split("\n").length;
  console.log(`assemble-index: index.html expands to ${lineCount} lines`);
}
