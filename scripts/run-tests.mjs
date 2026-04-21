#!/usr/bin/env node
import { spawnSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

function collectTestFiles(path) {
  if (!existsSync(path)) return [path];
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    const childStat = statSync(child);
    if (childStat.isDirectory()) {
      out.push(...collectTestFiles(child));
    } else if (/\.(test|spec)\.(mjs|js|ts)$/.test(entry)) {
      out.push(child);
    }
  }
  return out.sort();
}

const requested = process.argv.slice(2);
const files = requested.length
  ? requested.flatMap((path) => collectTestFiles(path))
  : collectTestFiles("tests");

if (files.length === 0) {
  console.error("test: no test files matched");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...files],
  { stdio: "inherit" },
);

process.exit(result.status === null ? 1 : result.status);
