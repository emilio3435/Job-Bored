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

function extractFunctionSource(src, functionName) {
  const anchor = `function ${functionName}(`;
  const start = src.indexOf(anchor);
  if (start === -1) {
    throw new Error(`Could not find ${functionName}() in app.js`);
  }
  const braceStart = src.indexOf("{", start);
  if (braceStart === -1) {
    throw new Error(`Could not find opening brace for ${functionName}()`);
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;

  for (let i = braceStart; i < src.length; i += 1) {
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

    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return src.slice(start, i + 1);
      }
    }
  }

  throw new Error(`Could not find closing brace for ${functionName}()`);
}

function loadAtsRequestBuilder(appJsSource) {
  const fnSource = extractFunctionSource(appJsSource, "buildAtsScorecardRequestPayload");
  return (0, eval)(`(${fnSource})`);
}

function validateOrExit(validate, data, label) {
  if (!validate(data)) {
    console.error(`Schema validation failed (${label}):`);
    console.error(validate.errors);
    process.exit(1);
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
let requestValidate = null;

for (const c of CASES) {
  const schema = JSON.parse(readFileSync(join(repoRoot, c.schema), "utf8"));
  const data = JSON.parse(readFileSync(join(repoRoot, c.example), "utf8"));
  const validate = ajv.compile(schema);
  if (c.schema === "schemas/ats-scorecard-request.v1.schema.json") {
    requestValidate = validate;
  }
  validateOrExit(validate, data, `${c.label}: ${c.example}`);
  console.log(`OK schema (${c.label}): ${c.example}`);
}

if (!requestValidate) {
  throw new Error("ATS request validator was not initialized");
}

const buildAtsScorecardRequestPayload = loadAtsRequestBuilder(
  readFileSync(join(repoRoot, "app.js"), "utf8"),
);

const fullPayload = buildAtsScorecardRequestPayload(
  "This cover letter contains more than twenty characters so ATS validation can run safely.",
  {
    title: "Frontend Engineer",
    company: "Acme Labs",
    link: "https://example.com/jobs/frontend-engineer",
    fitAssessment: "Strong fit for UI systems and growth loops.",
    talkingPoints: "Fast iteration, metrics ownership",
    notes: "Emphasize recruiter empathy and measurable outcomes.",
    _postingEnrichment: {
      description: "Build user-facing web products and collaborate with product and design.",
      requirements: [
        "3+ years of frontend experience",
        "Strong JavaScript and TypeScript fundamentals",
      ],
      skills: ["JavaScript", "TypeScript", "React", "CSS"],
      mustHaves: ["React", "TypeScript"],
      responsibilities: ["Ship product features", "Improve onboarding funnel"],
      toolsAndStack: ["React", "Node.js", "PostgreSQL"],
    },
  },
  {
    feature: "cover_letter",
    bundle: {
      job: {
        title: "Frontend Engineer",
        company: "Acme Labs",
        url: "https://example.com/jobs/frontend-engineer",
        fitAssessment: "Strong fit for UI systems and growth loops.",
        talkingPoints: "Fast iteration, metrics ownership",
        notes: "Emphasize recruiter empathy and measurable outcomes.",
        postingEnrichment: {
          description:
            "Build user-facing web products and collaborate with product and design.",
          requirements: [
            "3+ years of frontend experience",
            "Strong JavaScript and TypeScript fundamentals",
          ],
          skills: ["JavaScript", "TypeScript", "React", "CSS"],
          mustHaves: ["React", "TypeScript"],
          responsibilities: ["Ship product features", "Improve onboarding funnel"],
          toolsAndStack: ["React", "Node.js", "PostgreSQL"],
        },
      },
      profile: {
        candidateProfileText:
          "RESUME: Built React growth surfaces and wrote ATS-optimized messaging.",
        resumeSourceText: "Built product experiences in React and TypeScript.",
        linkedinProfileText: "Frontend engineer with analytics ownership.",
        additionalContextText: "Prefer concise, high-signal writing.",
      },
      instructions: {
        userNotes: "Keep the tone direct and concise.",
        refinementFeedback: "Increase emphasis on business impact.",
      },
      meta: {
        sheetId: "sheet_123",
        generatedAt: "2026-04-09T10:00:00.000Z",
      },
    },
  },
);
validateOrExit(requestValidate, fullPayload, "live ATS builder (full bundle)");
console.log("OK app.js ATS request builder matches schema for full bundle payload");

const sparsePayload = buildAtsScorecardRequestPayload(
  "This resume update draft still contains enough text to trigger ATS validation.",
  {
    title: "Platform Engineer",
    company: "Orbit Systems",
    link: "https://example.com/jobs/platform-engineer",
  },
  {
    feature: "resume_update",
  },
);
validateOrExit(requestValidate, sparsePayload, "live ATS builder (sparse payload)");
console.log("OK app.js ATS request builder matches schema for sparse payload");
