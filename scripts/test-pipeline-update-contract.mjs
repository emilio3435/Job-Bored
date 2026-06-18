import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const CASES = [
  {
    schema: "schemas/pipeline-update-request.v1.schema.json",
    example: "examples/pipeline-update-request.v1.json",
    label: "pipeline-update request",
  },
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

let failed = false;
for (const c of CASES) {
  const schema = JSON.parse(readFileSync(join(repoRoot, c.schema), "utf8"));
  const data = JSON.parse(readFileSync(join(repoRoot, c.example), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    console.error(`Schema validation failed (${c.label}): ${c.example}`);
    console.error(validate.errors);
    failed = true;
  } else {
    console.log(`OK schema (${c.label}): ${c.example}`);
  }
}
process.exit(failed ? 1 : 0);
