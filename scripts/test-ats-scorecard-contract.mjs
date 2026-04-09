#!/usr/bin/env node
/**
 * Validate ATS scorecard request/response examples against JSON Schema.
 */
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");

const CASES = [
  {
    schema: "schemas/ats-scorecard-request.v1.schema.json",
    example: "examples/ats-scorecard-request.v1.json",
    label: "ATS request",
  },
  {
    schema: "schemas/ats-scorecard-response.v1.schema.json",
    example: "examples/ats-scorecard-response.v1.json",
    label: "ATS response",
  },
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

for (const c of CASES) {
  const schema = JSON.parse(readFileSync(join(repoRoot, c.schema), "utf8"));
  const data = JSON.parse(readFileSync(join(repoRoot, c.example), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    console.error(`Schema validation failed (${c.label}): ${c.example}`);
    console.error(validate.errors);
    process.exit(1);
  }
  console.log(`OK schema (${c.label}): ${c.example}`);
}
