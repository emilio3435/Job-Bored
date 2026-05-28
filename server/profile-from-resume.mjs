/**
 * profile-from-resume.mjs
 *
 * Reads stored resume text, calls gemini-3.5-flash with structured output,
 * returns a UserProfile JSON (does NOT save it — user reviews in the wizard).
 *
 * Wired into POST /profile/from-resume in server/index.mjs.
 *
 * Storage locations checked (priority order — first hit wins):
 *   1. The discovery worker's `worker-config.json` at
 *      `candidateProfile.resumeText`. Path resolved via:
 *        - BROWSER_USE_DISCOVERY_CONFIG_PATH
 *        - DISCOVERY_WORKER_CONFIG_PATH
 *        - DISCOVERY_CONFIG_PATH
 *        - default: <repo>/integrations/browser-use-discovery/state/worker-config.json
 *   2. ~/.jobbored/resume.txt
 *   3. ~/.hermes/job-hunt/profile/resume*.md (legacy)
 *
 * Gemini API key comes from the same env vars ats-scorecard.mjs uses:
 *   ATS_GEMINI_API_KEY, then GEMINI_API_KEY.
 * Model: ATS_GEMINI_MODEL or "gemini-3.5-flash".
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo-relative fallback that matches the discovery worker's own default.
const DEFAULT_WORKER_CONFIG_PATH = resolvePath(
  __dirname,
  "..",
  "integrations",
  "browser-use-discovery",
  "state",
  "worker-config.json",
);

const MAX_RESUME_INPUT_CHARS = 60_000;

/* ─── Storage lookup ───────────────────────────────────────────────────── */

function resolveWorkerConfigPath() {
  const fromEnv =
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH ||
    process.env.DISCOVERY_WORKER_CONFIG_PATH ||
    process.env.DISCOVERY_CONFIG_PATH ||
    "";
  const raw = String(fromEnv || "").trim();
  if (raw) {
    return isAbsolute(raw) ? raw : resolvePath(process.cwd(), raw);
  }
  return DEFAULT_WORKER_CONFIG_PATH;
}

async function readResumeFromWorkerConfig() {
  const path = resolveWorkerConfigPath();
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // The worker may serialize config at top level OR nested under `config` /
  // `default` / `workerConfig` (see config.ts:1077). Cover all four.
  const root =
    (parsed && typeof parsed === "object" && (parsed.config || parsed.default || parsed.workerConfig || parsed)) ||
    {};
  const candidate =
    root && typeof root === "object" && root.candidateProfile
      ? root.candidateProfile
      : null;
  const text =
    candidate && typeof candidate.resumeText === "string"
      ? candidate.resumeText.trim()
      : "";
  if (!text) return null;
  return { text, source: "worker_config", path };
}

async function readResumeFromJobboredText() {
  const path = join(homedir(), ".jobbored", "resume.txt");
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const text = String(raw || "").trim();
  if (!text) return null;
  return { text, source: "jobbored_text", path };
}

async function readResumeFromLegacyHermes() {
  const dir = join(homedir(), ".hermes", "job-hunt", "profile");
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  // Prefer files literally named resume*.md. Falls back to resume-bullets.md
  // because that's what exists in legacy hermes installs.
  const candidates = entries
    .filter((name) => /^resume.*\.md$/i.test(name))
    .sort((a, b) => {
      // Prefer "resume.md" first, then "resume-something.md".
      if (/^resume\.md$/i.test(a)) return -1;
      if (/^resume\.md$/i.test(b)) return 1;
      return a.localeCompare(b);
    });
  for (const name of candidates) {
    const path = join(dir, name);
    try {
      const raw = await readFile(path, "utf8");
      const text = String(raw || "").trim();
      if (text) return { text, source: "legacy_hermes", path };
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Check known resume storage locations in priority order.
 * Returns { text, source, path } or null when nothing is found.
 */
export async function getStoredResumeText() {
  const fromWorker = await readResumeFromWorkerConfig();
  if (fromWorker) return fromWorker;
  const fromJobbored = await readResumeFromJobboredText();
  if (fromJobbored) return fromJobbored;
  const fromLegacy = await readResumeFromLegacyHermes();
  if (fromLegacy) return fromLegacy;
  return null;
}

/* ─── Gemini call ──────────────────────────────────────────────────────── */

function getGeminiConfig() {
  const apiKey = String(
    process.env.ATS_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
  ).trim();
  const model = String(
    process.env.ATS_GEMINI_MODEL || "gemini-3.5-flash",
  ).trim();
  return { apiKey, model };
}

const SYSTEM_PROMPT = `You read resumes and emit a structured "Fit Profile" JSON used by a job-matching scorer.
You return ONLY a JSON object that matches the provided responseSchema. No prose, no markdown fences.

The shape — UserProfile v1 — captures who the candidate is, what they want next, and what hard rules
apply when scoring listings. Sections:

- identity.primaryNarrative: first-person, 2-4 sentences, drawn from the resume. Describes who the
  candidate is professionally and what they want next. This text is embedded verbatim in the scorer
  prompt for every listing, so write it like the candidate would write it.
- identity.targetRoles: 3 most likely next-role titles based on trajectory. Look at the most recent
  roles and seniority. Project forward — these are roles the candidate would credibly land next, not
  just titles they have already held.
- identity.targetSeniority: pick from
  intern | entry | ic_mid | ic_senior | ic_staff | ic_principal | manager | director | head | vp | c_level | any.
  Base it on years of experience and role progression. Use "any" only when the resume is genuinely ambiguous.
- identity.yearsRelevantExperience: integer 0-60, inferred from work history dates.
- strengths: 4-6 ranked capability areas. rank 1 = top strength. For each, fill keywords[] with
  3-10 terms that ACTUALLY APPEAR in the resume (skills, tools, methodologies). Optional evidence is
  a 1-sentence proof point pulled from the resume.
- wants: leave [] — the user fills this in the wizard.
- avoids: leave [] — the user fills this in the wizard.
- hardConstraints.workMode: "any"
- hardConstraints.salaryRequired: false
- hardConstraints.acceptableLocations: []
- hardConstraints.workAuth: "us_authorized"
- starterTemplate: "custom"
- version: 1

If the resume is sparse or ambiguous, prefer safe defaults over guessing. Required fields must be
present and valid; missing optional fields can be omitted.`;

function buildUserPrompt(resumeText) {
  const clipped = resumeText.length > MAX_RESUME_INPUT_CHARS
    ? `${resumeText.slice(0, MAX_RESUME_INPUT_CHARS)}\n\n[resume truncated — ${resumeText.length - MAX_RESUME_INPUT_CHARS} characters omitted]`
    : resumeText;
  return [
    "Resume text follows. Read it, then emit the UserProfile JSON object.",
    "",
    "── BEGIN RESUME ──",
    clipped,
    "── END RESUME ──",
  ].join("\n");
}

// Gemini-flavored JSON schema (no $schema, no enums with descriptions in oneOf, etc.).
// Mirrors integrations/browser-use-discovery/src/contracts/user-profile.schema.json
// but trimmed to the subset Gemini's responseSchema accepts.
const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    version: { type: "integer" },
    starterTemplate: {
      type: "string",
      enum: ["marketer", "engineer", "product_manager", "data_scientist", "designer", "custom"],
    },
    identity: {
      type: "object",
      properties: {
        targetRoles: { type: "array", items: { type: "string" } },
        targetSeniority: {
          type: "string",
          enum: [
            "intern", "entry", "ic_mid", "ic_senior", "ic_staff", "ic_principal",
            "manager", "director", "head", "vp", "c_level", "any",
          ],
        },
        yearsRelevantExperience: { type: "integer" },
        primaryNarrative: { type: "string" },
      },
      required: ["targetRoles", "targetSeniority", "primaryNarrative"],
    },
    strengths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          rank: { type: "integer" },
          evidence: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
        },
        required: ["name", "rank"],
      },
    },
    wants: { type: "array", items: { type: "string" } },
    avoids: { type: "array", items: { type: "string" } },
    hardConstraints: {
      type: "object",
      properties: {
        workMode: {
          type: "string",
          enum: ["remote_only", "hybrid_ok", "onsite_ok", "any"],
        },
        salaryRequired: { type: "boolean" },
        acceptableLocations: { type: "array", items: { type: "string" } },
        workAuth: {
          type: "string",
          enum: ["us_citizen", "us_authorized", "needs_sponsorship", "any"],
        },
        skipTitles: { type: "array", items: { type: "string" } },
      },
      required: ["workMode"],
    },
  },
  required: ["version", "identity", "strengths", "hardConstraints"],
};

async function callGeminiForProfile(resumeText, opts = {}) {
  const cfg = getGeminiConfig();
  if (!cfg.apiKey) {
    const err = new Error(
      "Missing Gemini API key: set ATS_GEMINI_API_KEY or GEMINI_API_KEY.",
    );
    err.code = "GEMINI_NOT_CONFIGURED";
    throw err;
  }
  const model = opts.model || cfg.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(resumeText) }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 3500,
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const err = new Error(`Gemini request failed: ${cause && cause.message ? cause.message : cause}`);
    err.code = "GEMINI_REQUEST_FAILED";
    err.cause = cause;
    throw err;
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      `Gemini HTTP ${resp.status}`;
    const err = new Error(msg);
    err.code = "GEMINI_HTTP_ERROR";
    err.upstreamStatus = resp.status;
    throw err;
  }
  const raw =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!raw.trim()) {
    const err = new Error("Gemini returned empty content");
    err.code = "GEMINI_EMPTY_RESPONSE";
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    const err = new Error(`Gemini returned non-JSON content: ${cause.message}`);
    err.code = "GEMINI_PARSE_ERROR";
    err.rawSample = raw.slice(0, 400);
    throw err;
  }
  return parsed;
}

/* ─── Safe-default normalization ──────────────────────────────────────── */

const SENIORITY_ALLOWED = new Set([
  "intern", "entry", "ic_mid", "ic_senior", "ic_staff", "ic_principal",
  "manager", "director", "head", "vp", "c_level", "any",
]);
const WORK_MODE_ALLOWED = new Set(["remote_only", "hybrid_ok", "onsite_ok", "any"]);
const WORK_AUTH_ALLOWED = new Set(["us_citizen", "us_authorized", "needs_sponsorship", "any"]);
const STARTER_ALLOWED = new Set([
  "marketer", "engineer", "product_manager", "data_scientist", "designer", "custom",
]);

function clampString(value, min, max, fallback) {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length < min) return fallback;
  if (s.length > max) return s.slice(0, max);
  return s;
}

function clampNonEmptyStringArray(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, maxLen);
    if (!trimmed) continue;
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function clampStrengths(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  let rankCursor = 1;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const name = clampString(item.name, 2, 60, "");
    if (!name) continue;
    const rank = Number.isFinite(item.rank)
      ? Math.max(1, Math.min(8, Math.floor(item.rank)))
      : rankCursor;
    const entry = { name, rank };
    if (typeof item.evidence === "string" && item.evidence.trim()) {
      entry.evidence = item.evidence.trim().slice(0, 400);
    }
    const keywords = clampNonEmptyStringArray(item.keywords, 20, 40);
    if (keywords.length) entry.keywords = keywords;
    out.push(entry);
    rankCursor = rank + 1;
    if (out.length >= 8) break;
  }
  // Renumber ranks so they're 1..n contiguous (the schema doesn't require
  // contiguous ranks but downstream rendering assumes 1 = top).
  out.sort((a, b) => a.rank - b.rank);
  out.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });
  return out;
}

/**
 * Clamp + safe-default the Gemini response into a valid v1 UserProfile.
 * Always returns a profile shape; never throws on missing fields.
 */
function clampToUserProfile(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const identityRaw = obj.identity && typeof obj.identity === "object" ? obj.identity : {};
  const hcRaw = obj.hardConstraints && typeof obj.hardConstraints === "object" ? obj.hardConstraints : {};

  // identity.targetRoles — at least 1 entry required by schema.
  let targetRoles = clampNonEmptyStringArray(identityRaw.targetRoles, 8, 80);
  if (targetRoles.length === 0) targetRoles = ["Open to discussion"];

  // targetSeniority
  const seniority = SENIORITY_ALLOWED.has(identityRaw.targetSeniority)
    ? identityRaw.targetSeniority
    : "any";

  // primaryNarrative — schema requires 20..1200 chars.
  let primaryNarrative = typeof identityRaw.primaryNarrative === "string"
    ? identityRaw.primaryNarrative.trim()
    : "";
  if (primaryNarrative.length > 1200) primaryNarrative = primaryNarrative.slice(0, 1200);
  if (primaryNarrative.length < 20) {
    primaryNarrative =
      "Experienced professional. Resume parsed successfully but no narrative was generated — please edit this section before saving.";
  }

  const identity = { targetRoles, targetSeniority: seniority, primaryNarrative };
  if (Number.isFinite(identityRaw.yearsRelevantExperience)) {
    const years = Math.max(0, Math.min(60, Math.floor(identityRaw.yearsRelevantExperience)));
    identity.yearsRelevantExperience = years;
  }

  // strengths — at least 1 required.
  let strengths = clampStrengths(obj.strengths);
  if (strengths.length === 0) {
    strengths = [{ name: "Add a strength", rank: 1 }];
  }

  // hardConstraints
  const workMode = WORK_MODE_ALLOWED.has(hcRaw.workMode) ? hcRaw.workMode : "any";
  const hardConstraints = { workMode };
  if (typeof hcRaw.salaryRequired === "boolean") {
    hardConstraints.salaryRequired = hcRaw.salaryRequired;
  } else {
    hardConstraints.salaryRequired = false;
  }
  if (WORK_AUTH_ALLOWED.has(hcRaw.workAuth)) {
    hardConstraints.workAuth = hcRaw.workAuth;
  } else {
    hardConstraints.workAuth = "us_authorized";
  }
  const acceptableLocations = clampNonEmptyStringArray(hcRaw.acceptableLocations, 20, 80);
  if (acceptableLocations.length) hardConstraints.acceptableLocations = acceptableLocations;
  const skipTitles = clampNonEmptyStringArray(hcRaw.skipTitles, 30, 80);
  if (skipTitles.length) hardConstraints.skipTitles = skipTitles;

  // wants / avoids — wizard fills these.
  const wants = clampNonEmptyStringArray(obj.wants, 12, 200);
  const avoids = clampNonEmptyStringArray(obj.avoids, 12, 200);

  // starterTemplate
  const starterTemplate = STARTER_ALLOWED.has(obj.starterTemplate)
    ? obj.starterTemplate
    : "custom";

  const profile = {
    version: 1,
    starterTemplate,
    identity,
    strengths,
    hardConstraints,
  };
  if (wants.length) profile.wants = wants;
  if (avoids.length) profile.avoids = avoids;
  return profile;
}

/* ─── Public API ──────────────────────────────────────────────────────── */

/**
 * Call Gemini with the resume text and return a valid v1 UserProfile object.
 * Does NOT save the result — the wizard renders it and the user confirms.
 *
 * @param {string} resumeText
 * @param {object} [opts]
 * @param {string} [opts.model] — override default Gemini model.
 * @returns {Promise<object>} UserProfile
 */
export async function analyzeResumeToProfile(resumeText, opts = {}) {
  const text = String(resumeText || "").trim();
  if (!text) {
    const err = new Error("analyzeResumeToProfile: resumeText is empty");
    err.code = "EMPTY_RESUME";
    throw err;
  }
  const raw = await callGeminiForProfile(text, opts);
  return clampToUserProfile(raw);
}

// Expose for tests/scratch only — not part of the documented surface.
export const __test = { clampToUserProfile, resolveWorkerConfigPath };
