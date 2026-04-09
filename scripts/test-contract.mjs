#!/usr/bin/env node
/**
 * Validates discovery webhook examples against JSON Schema and ensures app.js
 * builds the same top-level keys as schemas/discovery-webhook-request.v1.schema.json.
 */
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");

const DISCOVERY_EXAMPLES = [
  "examples/discovery-webhook-request.v1.json",
  "examples/discovery-webhook-request.v1-with-profile.json",
];

const SCHEMA = "schemas/discovery-webhook-request.v1.schema.json";

function extractObjectLiteral(src, anchorToken) {
  const anchorIdx = src.indexOf(anchorToken);
  if (anchorIdx === -1) return "";
  const braceIdx = src.indexOf("{", anchorIdx);
  if (braceIdx === -1) return "";

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;

  for (let i = braceIdx; i < src.length; i += 1) {
    const ch = src[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (!inDouble && !inBacktick && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === "`") {
      inBacktick = !inBacktick;
      continue;
    }

    if (inSingle || inDouble || inBacktick) continue;

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return src.slice(braceIdx, i + 1);
      }
    }
  }

  return "";
}

function extractTopLevelKeysFromObjectLiteral(objectLiteralText, declarationLine) {
  const body = objectLiteralText
    .replace(/^\s*\{/, "")
    .replace(/\}\s*$/, "");

  const keys = [];
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (!t || t === declarationLine) continue;
    const m1 = /^([a-zA-Z_$][\w$]*)\s*:/.exec(t);
    if (m1) {
      keys.push(m1[1]);
      continue;
    }
    const m2 = /^([a-zA-Z_$][\w$]*)\s*,?\s*$/.exec(t);
    if (m2) keys.push(m2[1]);
  }
  return keys;
}

function extractDiscoveryPayloadKeys(appJs) {
  const buildStart = appJs.indexOf("async function buildDiscoveryWebhookPayload(");
  if (buildStart !== -1) {
    const builderFn = appJs.slice(buildStart);
    const returnObj = extractObjectLiteral(builderFn, "return {");
    if (returnObj) {
      const keys = extractTopLevelKeysFromObjectLiteral(returnObj, "return {");
      if (keys.length) return keys;
    }
  }

  // Backward-compatible fallback for older implementations.
  const triggerStart = appJs.indexOf("async function triggerDiscoveryRun()");
  if (triggerStart === -1) {
    throw new Error(
      "Neither buildDiscoveryWebhookPayload() nor triggerDiscoveryRun() payload object was found in app.js",
    );
  }
  const triggerFn = appJs.slice(triggerStart);
  const payloadObj = extractObjectLiteral(triggerFn, "const payload = {");
  if (!payloadObj) {
    throw new Error("Could not locate discovery payload object literal in app.js");
  }
  return extractTopLevelKeysFromObjectLiteral(payloadObj, "const payload = {");
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

const schemaPath = join(repoRoot, SCHEMA);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const expectedKeys = Object.keys(schema.properties ?? {}).sort();

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

for (const rel of DISCOVERY_EXAMPLES) {
  const data = JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));
  if (!validate(data)) {
    console.error(`Schema validation failed: ${rel}`);
    console.error(validate.errors);
    process.exit(1);
  }
  console.log(`OK schema: ${rel}`);
}

const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const payloadKeys = extractDiscoveryPayloadKeys(appJs).sort();
if (!sameSet(payloadKeys, expectedKeys)) {
  console.error("app.js triggerDiscoveryRun payload keys do not match schema properties.");
  console.error("  app.js:", payloadKeys.join(", "));
  console.error("  schema:", expectedKeys.join(", "));
  process.exit(1);
}
console.log("OK app.js discovery payload keys match", SCHEMA);
