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

const discoveryPayloadJs = readFileSync(
  join(repoRoot, "discovery-payload.js"),
  "utf8",
);
const missingPayloadKeys = expectedKeys.filter(
  (key) => !new RegExp(`\\b${key}\\b`).test(discoveryPayloadJs),
);
if (missingPayloadKeys.length) {
  console.error("discovery-payload.js does not mention every schema property.");
  console.error("  missing:", missingPayloadKeys.join(", "));
  process.exit(1);
}
console.log("OK discovery-payload.js covers schema properties", SCHEMA);

const discoveryReadinessJs = readFileSync(
  join(repoRoot, "discovery-readiness.js"),
  "utf8",
);
if (!discoveryReadinessJs.includes("sharedBuilder.buildDiscoveryWebhookPayload")) {
  console.error(
    "discovery-readiness.js must delegate payload construction to discovery-payload.js",
  );
  process.exit(1);
}
console.log("OK discovery-readiness.js delegates to discovery-payload.js");
