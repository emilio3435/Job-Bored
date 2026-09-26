/* ============================================
   server/profile-draft-shared.js
   Single source for Fit Profile drafting, consumed by BOTH:
   - the browser (classic global window.JobBoredProfileDraft,
     loaded via <script> before oneflow-beat-resume.js), for
     serverless direct drafting on the hosted site, and
   - the server (side-effect import; reads the same namespace
     off globalThis), for POST /profile/from-resume.
   Lives in server/ (not root) so the Docker image carries it.

   One prompt, one parser, one clamp — a fix here fixes both
   paths, and neither can drift from the other. Pure code only:
   no window/document/fetch at load, so the file runs unchanged
   as a <script> and as a Node import.
   ============================================ */
(function (root) {
  "use strict";

  /**
   * @typedef {object} ProfileStrength
   * @property {string} name
   * @property {number} rank
   * @property {string} [evidence]
   * @property {string[]} [keywords]
   */

  /**
   * @typedef {object} NormalizedUserProfile
   * @property {number} version
   * @property {string} starterTemplate
   * @property {{ targetRoles: string[], targetSeniority: string, primaryNarrative: string, yearsRelevantExperience?: number }} identity
   * @property {ProfileStrength[]} strengths
   * @property {{ workMode: string, salaryRequired?: boolean, workAuth?: string, acceptableLocations?: string[], skipTitles?: string[] }} hardConstraints
   * @property {string[]} [wants]
   * @property {string[]} [avoids]
   */

  const MAX_RESUME_INPUT_CHARS = 60_000;

  const SYSTEM_PROMPT = `You read resumes and emit a structured "Fit Profile" JSON used by a job-matching scorer.
You return ONLY a strict JSON object that matches the UserProfile v1 shape below. No prose, no markdown fences.

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
- wants: 3-5 short phrases naming what this candidate is looking for next, inferred from the
  resume's trajectory, stated interests, and the kinds of work they chose. Write them as the
  candidate would ("high-autonomy teams", "product-facing infrastructure work"), never as
  scoring instructions. Infer; do not invent facts.
- avoids: 2-4 short phrases naming what would be a step backwards for this candidate, inferred
  from the same evidence (e.g. a senior IC's resume implies avoiding entry-level scope). Keep
  them concrete and reviewable — the user confirms every one on the next screen.
- hardConstraints.workMode: "any"
- hardConstraints.salaryRequired: false
- hardConstraints.acceptableLocations: []
- hardConstraints.workAuth: "us_authorized"
- starterTemplate: "custom"
- version: 1

If the resume is sparse or ambiguous, prefer safe defaults over guessing. Required fields must be
present and valid; missing optional fields can be omitted.`;

  /** @param {string} resumeText */
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

  /**
   * @param {unknown} value
   * @returns {value is Record<string, unknown>}
   */
  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  const SENIORITY_ALLOWED = new Set([
    "intern", "entry", "ic_mid", "ic_senior", "ic_staff", "ic_principal",
    "manager", "director", "head", "vp", "c_level", "any",
  ]);
  const WORK_MODE_ALLOWED = new Set(["remote_only", "hybrid_ok", "onsite_ok", "any"]);
  const WORK_AUTH_ALLOWED = new Set(["us_citizen", "us_authorized", "needs_sponsorship", "any"]);
  const STARTER_ALLOWED = new Set([
    "marketer", "engineer", "product_manager", "data_scientist", "designer", "custom",
  ]);

  /**
   * @param {unknown} value
   * @param {number} min
   * @param {number} max
   * @param {string} fallback
   */
  function clampString(value, min, max, fallback) {
    const s = typeof value === "string" ? value.trim() : "";
    if (s.length < min) return fallback;
    if (s.length > max) return s.slice(0, max);
    return s;
  }

  /**
   * @param {unknown} value
   * @param {number} maxItems
   * @param {number} maxLen
   */
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

  /**
   * @param {unknown} value
   * @returns {ProfileStrength[]}
   */
  function clampStrengths(value) {
    if (!Array.isArray(value)) return [];
    /** @type {ProfileStrength[]} */
    const out = [];
    let rankCursor = 1;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = /** @type {Record<string, unknown>} */ (item);
      const name = clampString(record.name, 2, 60, "");
      if (!name) continue;
      const rank = typeof record.rank === "number" && Number.isFinite(record.rank)
        ? Math.max(1, Math.min(8, Math.floor(record.rank)))
        : rankCursor;
      /** @type {ProfileStrength} */
      const entry = { name, rank };
      if (typeof record.evidence === "string" && record.evidence.trim()) {
        entry.evidence = record.evidence.trim().slice(0, 400);
      }
      const keywords = clampNonEmptyStringArray(record.keywords, 20, 40);
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

  /** @param {string} raw */
  function tryParseEmbeddedJson(raw) {
    for (let start = 0; start < raw.length; start += 1) {
      if (raw[start] !== "{") continue;
      const stack = ["{"];
      let inString = false;
      let escaped = false;
      for (let i = start + 1; i < raw.length; i += 1) {
        const ch = raw[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\" && inString) {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === "{") {
          stack.push(ch);
          continue;
        }
        if (ch !== "}") continue;
        stack.pop();
        if (stack.length) continue;
        const candidate = raw.slice(start, i + 1).trim();
        try {
          return JSON.parse(candidate);
        } catch {
          break;
        }
      }
    }
    return undefined;
  }

  /** @param {unknown} text */
  function parseJsonSafe(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("empty JSON payload");
    const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(raw);
    const cleaned = fenced ? fenced[1].trim() : raw;
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      if (!cleaned.startsWith("{")) {
        const embedded = tryParseEmbeddedJson(cleaned);
        if (embedded !== undefined) return embedded;
      }
      throw error;
    }
  }

  /**
   * Clamp + safe-default the provider response into a valid v1 UserProfile.
   * Always returns a profile shape; never throws on missing fields.
   * @param {unknown} raw
   * @returns {NormalizedUserProfile}
   */
  function clampToUserProfile(raw) {
    const obj = isRecord(raw) ? raw : {};
    const identityRaw = isRecord(obj.identity) ? obj.identity : {};
    const hcRaw = isRecord(obj.hardConstraints) ? obj.hardConstraints : {};

    // identity.targetRoles — at least 1 entry required by schema.
    let targetRoles = clampNonEmptyStringArray(identityRaw.targetRoles, 8, 80);
    if (targetRoles.length === 0) targetRoles = ["Open to discussion"];

    // targetSeniority
    const seniority = typeof identityRaw.targetSeniority === "string" &&
      SENIORITY_ALLOWED.has(identityRaw.targetSeniority)
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

    /** @type {NormalizedUserProfile["identity"]} */
    const identity = { targetRoles, targetSeniority: seniority, primaryNarrative };
    if (
      typeof identityRaw.yearsRelevantExperience === "number" &&
      Number.isFinite(identityRaw.yearsRelevantExperience)
    ) {
      const years = Math.max(0, Math.min(60, Math.floor(identityRaw.yearsRelevantExperience)));
      identity.yearsRelevantExperience = years;
    }

    // strengths — at least 1 required.
    let strengths = clampStrengths(obj.strengths);
    if (strengths.length === 0) {
      strengths = [{ name: "Add a strength", rank: 1 }];
    }

    // hardConstraints
    const workMode = typeof hcRaw.workMode === "string" && WORK_MODE_ALLOWED.has(hcRaw.workMode)
      ? hcRaw.workMode
      : "any";
    /** @type {NormalizedUserProfile["hardConstraints"]} */
    const hardConstraints = { workMode };
    if (typeof hcRaw.salaryRequired === "boolean") {
      hardConstraints.salaryRequired = hcRaw.salaryRequired;
    } else {
      hardConstraints.salaryRequired = false;
    }
    if (typeof hcRaw.workAuth === "string" && WORK_AUTH_ALLOWED.has(hcRaw.workAuth)) {
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
    const starterTemplate = typeof obj.starterTemplate === "string" &&
      STARTER_ALLOWED.has(obj.starterTemplate)
      ? obj.starterTemplate
      : "custom";

    /** @type {NormalizedUserProfile} */
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

  const api = {
    SYSTEM_PROMPT,
    MAX_RESUME_INPUT_CHARS,
    buildUserPrompt,
    parseJsonSafe,
    clampToUserProfile,
  };

  root.JobBoredProfileDraft = api;
  if (typeof window !== "undefined") {
    /** @type {any} */ (window).JobBoredProfileDraft = api;
  }
})(/** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : this));
