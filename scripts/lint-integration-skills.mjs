#!/usr/bin/env node
/**
 * Ensures each integrations/.../SKILL.md links to the agent contract and discovery schema.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, "..");
const integrationsDir = join(repoRoot, "integrations");

const REQUIRED_SUBSTRINGS = [
  "AGENT_CONTRACT.md",
  "schemas/discovery-webhook-request.v1.schema.json",
];

function walkSkillMd(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walkSkillMd(full, out);
    } else if (name === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}

const skills = walkSkillMd(integrationsDir);
if (skills.length === 0) {
  console.error("No integrations/**/SKILL.md files found.");
  process.exit(1);
}

let failed = false;
for (const file of skills) {
  const rel = file.slice(repoRoot.length + 1);
  const text = readFileSync(file, "utf8");
  const missing = REQUIRED_SUBSTRINGS.filter((s) => !text.includes(s));
  if (missing.length) {
    failed = true;
    console.error(`${rel}: missing required references: ${missing.join(", ")}`);
  } else {
    console.log(`OK ${rel}`);
  }
}

process.exit(failed ? 1 : 0);
