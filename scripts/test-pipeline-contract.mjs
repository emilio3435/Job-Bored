#!/usr/bin/env node
/**
 * Ensures schemas/pipeline-row.v1.json matches README Sheet Structure,
 * app.js status/priority/response enums, and header row order.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");

const PIPELINE_SCHEMA = "schemas/pipeline-row.v1.json";
const README = "README.md";
const APP = "app.js";

function loadJson(rel) {
  return JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
}

function extractStatusesFromAppJs(appJs) {
  const fn = appJs.indexOf("function renderCardActions(");
  if (fn === -1) throw new Error("renderCardActions not found");
  const sub = appJs.slice(fn);
  const start = sub.indexOf("const statuses = [");
  if (start === -1) throw new Error("const statuses = [ not found in renderCardActions");
  const rest = sub.slice(start);
  const open = rest.indexOf("[");
  const close = rest.indexOf("];");
  if (open === -1 || close === -1) throw new Error("statuses array bounds not found");
  const inner = rest.slice(open + 1, close);
  const out = [];
  for (const part of inner.split(",")) {
    const t = part.trim();
    if (!t) continue;
    out.push(JSON.parse(t));
  }
  if (out.length === 0) throw new Error("no status strings parsed from app.js");
  return out;
}

function extractPriorityKeysFromAppJs(appJs) {
  const m = /const priorityOrder = \{([^}]+)\}/.exec(appJs);
  if (!m) throw new Error("const priorityOrder = { ... } not found in app.js");
  const inner = m[1];
  const keys = [];
  const keyRe = /"([^"]+)":\s*\d+/g;
  let k;
  while ((k = keyRe.exec(inner))) {
    keys.push(JSON.parse(`"${k[1]}"`));
  }
  if (keys.length === 0) throw new Error("no priority keys parsed");
  const m2 = /const order = \{([^}]+)\}/.exec(appJs);
  if (m2) {
    const keys2 = [];
    const keyRe2 = /"([^"]+)":\s*\d+/g;
    let k2;
    while ((k2 = keyRe2.exec(m2[1]))) {
      keys2.push(JSON.parse(`"${k2[1]}"`));
    }
    if (keys2.join("\0") !== keys.join("\0")) {
      throw new Error("priorityRank order object keys differ from priorityOrder");
    }
  }
  return keys;
}

function parseReadmePipelineHeaders(readme) {
  const start = readme.indexOf("### Pipeline (main tracker)");
  if (start === -1) throw new Error("### Pipeline (main tracker) not found in README");
  const after = readme.slice(start);
  const end = after.indexOf("\n## ");
  const section = end === -1 ? after : after.slice(0, end);
  const byLetter = {};
  const lineRe = /^\| ([A-S]):\s*([^|]+?)\s*\|/gm;
  let m;
  while ((m = lineRe.exec(section))) {
    const letter = m[1];
    const label = m[2].trim();
    if (byLetter[letter]) {
      throw new Error(`README: duplicate row for column ${letter}`);
    }
    byLetter[letter] = label;
  }
  const letters = Object.keys(byLetter).sort();
  if (letters.length !== 19) {
    throw new Error(
      `README Pipeline table: expected 19 rows A–S, got ${letters.length}`,
    );
  }
  return byLetter;
}

function sameOrdered(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function col(schema, id) {
  return schema.columns.find((c) => c.id === id);
}

const schema = loadJson(PIPELINE_SCHEMA);
const appJs = readFileSync(join(repoRoot, APP), "utf8");
const readme = readFileSync(join(repoRoot, README), "utf8");

if (schema.schemaVersion !== 1) {
  console.error("Expected pipeline-row schemaVersion 1");
  process.exit(1);
}
if (schema.tabName !== "Pipeline") {
  console.error('Expected tabName "Pipeline"');
  process.exit(1);
}

const readmeByLetter = parseReadmePipelineHeaders(readme);

for (const c of schema.columns) {
  const fromReadme = readmeByLetter[c.letter];
  if (fromReadme !== c.headerLabel) {
    console.error(
      `README vs schema header mismatch for ${c.letter}: README "${fromReadme}" schema "${c.headerLabel}"`,
    );
    process.exit(1);
  }
}

if (!sameOrdered(schema.headerRow, schema.columns.map((c) => c.headerLabel))) {
  console.error("headerRow array must match columns[].headerLabel in order");
  process.exit(1);
}

for (let i = 0; i < schema.columns.length; i++) {
  const c = schema.columns[i];
  if (c.sheetIndex !== i) {
    console.error(`columns[${i}] sheetIndex must be ${i}`);
    process.exit(1);
  }
}

const appStatuses = extractStatusesFromAppJs(appJs);
const schemaStatusEnum = col(schema, "status").enum;
if (!sameOrdered(appStatuses, schemaStatusEnum)) {
  console.error("app.js statuses array must match pipeline-row status enum (same order).");
  console.error("  app.js:", appStatuses.join(", "));
  console.error("  schema:", schemaStatusEnum.join(", "));
  process.exit(1);
}

const appPriorityKeys = extractPriorityKeysFromAppJs(appJs);
const schemaPriEnum = col(schema, "priority").enum;
if (
  !sameOrdered(
    [...appPriorityKeys].sort(),
    [...schemaPriEnum].sort(),
  )
) {
  console.error("priority keys in app.js must match pipeline-row priority enum.");
  console.error("  app.js:", appPriorityKeys.join(", "));
  console.error("  schema:", schemaPriEnum.join(", "));
  process.exit(1);
}
if (!sameOrdered(appPriorityKeys, schemaPriEnum)) {
  console.error(
    "priority order in app.js objects must match pipeline-row enum order (🔥 ⚡ — ↓).",
  );
  console.error("  app.js:", appPriorityKeys.join(", "));
  console.error("  schema:", schemaPriEnum.join(", "));
  process.exit(1);
}

const schemaReplyEnum = col(schema, "responseFlag").enum;
const expectedReply = ["Yes", "No", "Unknown"];
if (!sameOrdered(schemaReplyEnum, expectedReply)) {
  console.error("responseFlag enum must be Yes, No, Unknown");
  process.exit(1);
}

console.log(`OK ${PIPELINE_SCHEMA} ↔ ${README} ↔ ${APP}`);
