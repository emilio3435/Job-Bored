/**
 * user-profile.mjs — disk persistence + ajv validation + starter templates
 * for the canonical JobBored UserProfile (Task #4).
 *
 * Storage:
 *   ~/.jobbored/profile.json          (canonical, JSON, v1)
 *   ~/.jobbored/profile.json.bak.<ts> (pre-save backup if previous existed)
 *
 * Schema:
 *   integrations/browser-use-discovery/src/contracts/user-profile.schema.json
 *   (single source of truth; do NOT duplicate the shape here)
 *
 * Env override:
 *   JOBBORED_PROFILE_PATH — absolute path to a profile.json. When set, both
 *   the canonical path AND backup naming use this location's directory.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA_PATH = resolvePath(
  __dirname,
  "..",
  "integrations",
  "browser-use-discovery",
  "src",
  "contracts",
  "user-profile.schema.json",
);

let cachedValidator = null;

function loadValidator() {
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  // The schema declares draft-2020-12; use the Ajv2020 entrypoint so the
  // metaschema resolves without a network fetch.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/**
 * Resolve the profile path. Priority:
 *   1. JOBBORED_PROFILE_PATH env (must be absolute)
 *   2. ~/.jobbored/profile.json
 */
export function resolveProfilePath() {
  const envPath = String(process.env.JOBBORED_PROFILE_PATH || "").trim();
  if (envPath) {
    if (!isAbsolute(envPath)) {
      throw new Error(
        `JOBBORED_PROFILE_PATH must be absolute; got "${envPath}"`,
      );
    }
    return envPath;
  }
  return join(homedir(), ".jobbored", "profile.json");
}

async function ensureParentDir(path) {
  const parent = dirname(path);
  if (!existsSync(parent)) {
    await mkdir(parent, { recursive: true });
  }
}

/**
 * Read the canonical profile. Returns:
 *   { ok: true, profile, path }
 *   { ok: false, reason: "no_profile" } when the file is missing
 *   { ok: false, reason: "invalid_json", detail } when unparseable
 */
export async function readProfile() {
  const path = resolveProfilePath();
  if (!existsSync(path)) {
    return { ok: false, reason: "no_profile" };
  }
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    return { ok: false, reason: "read_failed", detail: String(err.message || err) };
  }
  try {
    const profile = JSON.parse(raw);
    return { ok: true, profile, path };
  } catch (err) {
    return { ok: false, reason: "invalid_json", detail: String(err.message || err) };
  }
}

/**
 * Validate against the ajv schema. Returns { ok: true, profile } or
 * { ok: false, errors: [...] }. Does not mutate input.
 */
export function validateProfile(candidate) {
  const validate = loadValidator();
  const ok = validate(candidate);
  if (ok) return { ok: true, profile: candidate };
  return {
    ok: false,
    errors: (validate.errors || []).map((e) => ({
      instancePath: e.instancePath || "",
      schemaPath: e.schemaPath || "",
      keyword: e.keyword || "",
      message: e.message || "validation failed",
      params: e.params || {},
    })),
  };
}

/**
 * Atomically write the profile. Steps:
 *   1. Validate against the schema (refuse on failure — fail loud).
 *   2. Ensure ~/.jobbored/ exists.
 *   3. If a previous profile.json exists, copy it to
 *      profile.json.bak.<ISO timestamp>.
 *   4. Write to <path>.tmp, then rename → final path.
 *   5. Return { updatedAt, path }.
 *
 * Always stamps `updatedAt` to "now" before writing; preserves `createdAt`
 * if the caller didn't provide one and a previous file existed.
 */
export async function writeProfileAtomic(candidate) {
  const validation = validateProfile(candidate);
  if (!validation.ok) {
    const err = new Error("invalid_profile");
    err.code = "INVALID_PROFILE";
    err.errors = validation.errors;
    throw err;
  }
  const path = resolveProfilePath();
  await ensureParentDir(path);

  const nowIso = new Date().toISOString();
  const toWrite = { ...candidate };
  toWrite.updatedAt = nowIso;

  let priorCreatedAt = null;
  if (existsSync(path)) {
    try {
      const prior = JSON.parse(await readFile(path, "utf8"));
      if (prior && typeof prior.createdAt === "string") {
        priorCreatedAt = prior.createdAt;
      }
    } catch (_) {
      // Corrupt previous file — leave the backup as proof, write fresh.
    }
    // Backup before overwrite. .bak.<safeTimestamp> (colons + dots → dashes
    // so it is filesystem-safe on every platform we support).
    const safeStamp = nowIso.replace(/[:.]/g, "-");
    const backupPath = `${path}.bak.${safeStamp}`;
    try {
      await rename(path, backupPath);
    } catch (_renameErr) {
      // Cross-device or race — fall back to copy-via-read/write.
      const raw = await readFile(path, "utf8");
      await writeFile(backupPath, raw, "utf8");
    }
  }

  if (!toWrite.createdAt) {
    toWrite.createdAt = priorCreatedAt || nowIso;
  }

  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(toWrite, null, 2) + "\n", "utf8");
  await rename(tmpPath, path);

  return { updatedAt: nowIso, path };
}

/* ─── Starter templates ──────────────────────────────────────────────────
 * Three templates ship with the v1 wizard. Users can edit any field after
 * seeding. The wizard fetches these via POST /profile/template/:id so the
 * authoritative defaults live server-side and the client never has to
 * duplicate the JSON.
 */

const TEMPLATES = Object.freeze({
  marketer: () => ({
    version: 1,
    starterTemplate: "marketer",
    identity: {
      targetRoles: [
        "Director of Performance Marketing",
        "Senior Marketing Manager",
      ],
      targetSeniority: "director",
      yearsRelevantExperience: 8,
      primaryNarrative:
        "Growth marketer who has owned both brand and performance for B2C and B2B brands. I run paid acquisition, lifecycle, and content as one system, and I judge channels on contribution margin, not vanity reach. I want a senior role where strategy, budget, and execution all sit on my desk.",
    },
    strengths: [
      {
        name: "Performance marketing",
        rank: 1,
        evidence:
          "Built and ran paid acquisition (Google, Meta, programmatic) at $5M+ annual spend with CAC payback under 12 months.",
        keywords: ["paid acquisition", "CAC", "ROAS", "attribution"],
      },
      {
        name: "Brand & content",
        rank: 2,
        evidence:
          "Owned editorial calendar and brand voice across web, social, and email; led two refreshes from positioning to launch.",
        keywords: ["brand", "content strategy", "positioning"],
      },
      {
        name: "Analytics & experimentation",
        rank: 3,
        evidence:
          "Built marketing analytics stack (GA4 + warehouse) and ran a continuous experimentation program with weekly tests.",
        keywords: ["analytics", "A/B testing", "MMM", "attribution"],
      },
      {
        name: "Channel management",
        rank: 4,
        evidence:
          "Managed an in-house + agency channel team of 6, coordinating launches across paid, organic, lifecycle, and partnerships.",
        keywords: ["channel mix", "agency management", "lifecycle"],
      },
    ],
    wants: [
      "P&L responsibility",
      "Mix of brand and performance",
      "Direct reports",
      "Cross-functional partnership with product",
    ],
    avoids: [
      "Pure community management",
      "Agency-side account management",
      "Heavy events / field marketing",
    ],
    hardConstraints: {
      workMode: "any",
      acceptableLocations: [],
      workAuth: "any",
      skipTitles: ["intern", "associate", "coordinator"],
      salaryRequired: false,
    },
  }),

  engineer: () => ({
    version: 1,
    starterTemplate: "engineer",
    identity: {
      targetRoles: ["Staff Software Engineer", "Senior Backend Engineer"],
      targetSeniority: "ic_staff",
      yearsRelevantExperience: 10,
      primaryNarrative:
        "Senior backend engineer focused on distributed systems and developer platforms. I've shipped infrastructure other engineers build on top of, and I optimize for clarity, durability, and review velocity. I want a staff-level IC role where I can drive architecture across teams without becoming a people manager.",
    },
    strengths: [
      {
        name: "Backend systems",
        rank: 1,
        evidence:
          "Designed and shipped Go/Rust services handling 10k+ RPS with sub-50ms p99 latency; owned schema design and migration path.",
        keywords: ["Go", "Rust", "PostgreSQL", "Kafka", "gRPC"],
      },
      {
        name: "Distributed systems",
        rank: 2,
        evidence:
          "Led migration from monolith to event-driven microservices; wrote the durability + idempotency contract every service follows.",
        keywords: ["microservices", "event-driven", "idempotency", "kubernetes"],
      },
      {
        name: "Code quality & review culture",
        rank: 3,
        evidence:
          "Set up the team's review standards, ran weekly architecture reviews, and mentored mid-level engineers into senior promotions.",
        keywords: ["code review", "mentorship", "testing"],
      },
      {
        name: "Technical leadership (IC)",
        rank: 4,
        evidence:
          "Drove multi-quarter platform initiatives across 3–4 teams as the technical lead without taking on people management.",
        keywords: ["technical lead", "RFC", "architecture review"],
      },
    ],
    wants: [
      "Hands-on coding",
      "Architecture ownership",
      "Strong code review culture",
      "Backend / platform focus",
    ],
    avoids: [
      "Pure people management",
      "Heavy on-call rotation without staffing",
      "Greenfield-only environments with no production load",
    ],
    hardConstraints: {
      workMode: "any",
      acceptableLocations: [],
      workAuth: "any",
      skipTitles: ["intern", "junior", "associate", "manager", "director"],
      salaryRequired: false,
    },
  }),

  product_manager: () => ({
    version: 1,
    starterTemplate: "product_manager",
    identity: {
      targetRoles: ["Senior Product Manager", "Principal PM"],
      targetSeniority: "ic_senior",
      yearsRelevantExperience: 7,
      primaryNarrative:
        "Senior PM with a strong technical background. I work close to engineering, prototype in code when it speeds a decision, and ship by writing crisp specs the team can execute against. I want a role where I own a meaningful surface end-to-end, not a slice of someone else's roadmap.",
    },
    strengths: [
      {
        name: "Product strategy",
        rank: 1,
        evidence:
          "Owned the multi-quarter roadmap for a $20M ARR product surface; tied every initiative to a measurable outcome.",
        keywords: ["roadmap", "strategy", "OKRs", "north-star metric"],
      },
      {
        name: "User research & discovery",
        rank: 2,
        evidence:
          "Ran continuous discovery: 6–8 user conversations weekly synthesized into a living opportunity tree.",
        keywords: ["user research", "discovery", "interviews", "Jobs-to-be-Done"],
      },
      {
        name: "Technical fluency",
        rank: 3,
        evidence:
          "CS background, comfortable in the codebase; wrote API specs reviewed by senior engineers without translation overhead.",
        keywords: ["APIs", "SQL", "technical PM"],
      },
      {
        name: "Cross-functional leadership",
        rank: 4,
        evidence:
          "Led pods of engineering + design + data science; ran the team's writing-first decision-making process.",
        keywords: ["cross-functional", "writing culture", "decision-making"],
      },
    ],
    wants: [
      "Outcome ownership",
      "Strong design partnership",
      "Direct user contact",
      "Crisp written-decision culture",
    ],
    avoids: [
      "Pure project management",
      "Roadmap-by-committee environments",
      "No engineering counterpart",
    ],
    hardConstraints: {
      workMode: "any",
      acceptableLocations: [],
      workAuth: "any",
      skipTitles: ["associate product manager", "apm", "intern"],
      salaryRequired: false,
    },
  }),
});

export function listStarterTemplateIds() {
  return Object.keys(TEMPLATES);
}

/**
 * Build a starter template profile. Returns null for unknown IDs so the
 * caller can 404. Each call returns a fresh deep copy.
 */
export function buildStarterTemplate(id) {
  const factory = TEMPLATES[String(id || "").trim()];
  if (!factory) return null;
  return factory();
}
