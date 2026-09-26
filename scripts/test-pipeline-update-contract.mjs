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
  {
    schema: "schemas/pipeline-update-request.v2.schema.json",
    example: "examples/pipeline-update-request.v2.json",
    label: "pipeline-update request v2",
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
// v2 invariants (BEAUDIT D7): Applied requires appliedDate and source, and
// dates are YYYY-MM-DD. Each body below must be rejected by the v2 schema.
{
  const v2 = ajv.getSchema(
    "https://github.com/job-bored/command-center/schemas/pipeline-update-request.v2.schema.json",
  );
  const base = JSON.parse(readFileSync(join(repoRoot, "examples/pipeline-update-request.v2.json"), "utf8"));
  const bad = [
    ["Applied without appliedDate", { stage: "Applied", source: "Company portal" }],
    ["Applied without source", { stage: "Applied", appliedDate: "2026-09-25" }],
    ["Applied with an empty appliedDate", { stage: "Applied", appliedDate: "", source: "Company portal" }],
    ["Applied with a blank source", { stage: "Applied", appliedDate: "2026-09-25", source: " " }],
    ["free-text appliedDate", { appliedDate: "next tuesday" }],
    ["free-text lastContact", { lastContact: "yesterday" }],
  ];
  for (const [label, fields] of bad) {
    if (v2({ ...base, fields })) {
      console.error(`v2 schema accepted an invalid body: ${label}`);
      failed = true;
    } else {
      console.log(`OK v2 rejects: ${label}`);
    }
  }
  if (!v2({ ...base, fields: { stage: "Interviewing", note: "Recruiter replied" } })) {
    console.error("v2 schema rejected a non-Applied stage move without appliedDate");
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
