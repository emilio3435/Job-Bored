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
- resumeFacts: { skills: { hard: [], tools: [], soft: [] } } — label each skill listed under
  "SKILL ITEMS" by its id (e.g. "skill-3"): hard for a domain skill or method, tools for software,
  platforms and programming languages, soft for an interpersonal skill. Use only the listed ids,
  each at most once. Never write a name, a title, or any other text here — JobBored reads the
  resume's employers, roles, dates, skills and credentials itself.

If the resume is sparse or ambiguous, prefer safe defaults over guessing. Required fields must be
present and valid; missing optional fields can be omitted.`;

  /** @param {string} resumeText */
  function buildUserPrompt(resumeText) {
    const clipped = resumeText.length > MAX_RESUME_INPUT_CHARS
      ? `${resumeText.slice(0, MAX_RESUME_INPUT_CHARS)}\n\n[resume truncated — ${resumeText.length - MAX_RESUME_INPUT_CHARS} characters omitted]`
      : resumeText;
    /* The skill ids resumeFacts may label (the parser's, never the model's text). */
    const skills = readResumeLists(clipped).skills;
    return [
      "Resume text follows. Read it, then emit the UserProfile JSON object.",
      "",
      "── BEGIN RESUME ──",
      clipped,
      "── END RESUME ──",
      ...(skills.length
        ? ["", "── SKILL ITEMS (ids for resumeFacts.skills) ──", ...skills.map((item) => `${item.id}: ${item.text}`)]
        : []),
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

  /**
   * The model's `resumeFacts` block, or null. Kept raw: the server checks
   * every string against the resume text before showing it
   * (server/resume-read.mjs).
   * @param {unknown} raw
   * @returns {Record<string, unknown> | null}
   */
  function resumeFactsOf(raw) {
    return isRecord(raw) && isRecord(raw.resumeFacts) ? raw.resumeFacts : null;
  }

  /* ── What the resume lists, and the model's labels for it (RESJ2-EXTRACT) ──
   * The parser below is the only writer of what the user reads (Grok
   * review, round 3): it reads skills, certifications, awards, languages,
   * projects, education and the summary under one heading classifier, used
   * by the server (server/resume-read.mjs) and the browser-direct draft
   * alike. Each skill gets an id; the prompt lists those ids and the model
   * may only label them hard, tools or soft. Any other string or id in
   * resumeFacts is counted in `dropped` and discarded. */

  const LIST_BULLET_RE = /^\s*(?:[-•*·▪●◦‣⁃➢■]|\d+[.)])\s+/;
  const RANGE_TAIL_RE =
    /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2}\s*(?:[–—-]+|to|until)\s*(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2}|present|current|now|today)/i;
  const LABEL_RE = /^([A-Za-z][A-Za-z /&+-]{1,38}):\s*(.+)$/;
  const METRIC_TOKEN_RE = /(?:[$#]\s?)?\d[\d,]*(?:\.\d+)?(?:%|x\b|[kKmMbB]\b\+?|\+)?/g;
  const CAPS_HEADING_RE = /^[A-Z][A-Z\s&/,-]{2,47}$/;
  const HEADING_WORDS_RE =
    /^(?:(?:professional|career|executive|work|relevant|earlier|additional|selected|key|core|technical|other|volunteer|project)\s+)*(?:summary|profile|objective|about(?: me)?|experience|employment(?: history)?|work history|career history|education(?: (?:and|&) training)?|academic background|skills|competencies|expertise|tools|technologies|tech stack|certifications?(?: (?:and|&) (?:licenses|languages|training))?|licenses(?: (?:and|&) certifications)?|awards(?: (?:and|&) (?:honors|recognition|achievements))?|honors(?: (?:and|&) awards)?|recognition|achievements(?: (?:and|&) recognition)?|accomplishments|projects|portfolio|publications|languages|interests|volunteering|references)$/i;
  const HUMAN_LANGUAGES = new Set(
    (
      "english spanish french german portuguese italian dutch mandarin chinese cantonese japanese korean " +
      "arabic hindi urdu bengali punjabi russian ukrainian polish czech greek turkish hebrew persian farsi " +
      "vietnamese thai tagalog filipino indonesian malay swahili swedish norwegian danish finnish hungarian " +
      "romanian bulgarian serbian croatian asl"
    ).split(" "),
  );
  const SOFT_SKILL_RE =
    /^(?:leadership|communication|collaboration|teamwork|mentoring|coaching|negotiation|presentation|public speaking|problem[- ]solving|critical thinking|time management|stakeholder management|adaptability|creativity|empathy|conflict resolution|relationship building|team leadership|cross-functional collaboration|storytelling|attention to detail)s?$/i;
  const CREDENTIAL_RE =
    /\b(?:certified|certification|certificate|license|licensed|licence)\b|^(?:PMP|CPA|CFA|CISSP|CISA|CISM|PHR|SPHR|SHRM-CP|SHRM-SCP|CSM|CSPO|CCNA|CCNP|ITIL|CAPM)$|six sigma/i;

  /** @typedef {"summary" | "experience" | "highlights" | "skills" | "education" | "certifications" | "awards" | "languages" | "projects" | "other"} LineKind */
  /** @typedef {"hard" | "tools" | "soft"} SkillBucket */
  /**
   * @typedef {object} ResumeLists
   * @property {string} summary
   * @property {Array<{ id: string, text: string, bucket: SkillBucket }>} skills
   * @property {string[]} certifications
   * @property {string[]} awards
   * @property {string[]} languages
   * @property {string[]} education
   * @property {Array<{ name: string, url: string }>} projects
   * @property {string[]} projectLines every line under a projects heading
   * @property {Array<{ text: string, kinds: Set<LineKind>, bullet: boolean, dated: boolean }>} lines
   */

  /** @param {unknown} value @param {number} [max] */
  function cleanFact(value, max = 200) {
    const t = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return t.length > max ? t.slice(0, max).trim() : t;
  }

  /**
   * The one heading classifier (server and browser). Null when the line is
   * not a heading. An award, honor or recognition heading holds awards even
   * when it also says achievements.
   * @param {string} line
   * @returns {Set<LineKind> | null}
   */
  function headingKinds(line) {
    const t = String(line || "").replace(/[:\s]+$/, "").trim();
    if (t.length > 48 || t.length < 4) return null;
    const words = HEADING_WORDS_RE.test(t);
    const caps = CAPS_HEADING_RE.test(t) && t.split(/\s+/).length <= 5;
    if (!words && !caps) return null;
    const w = t.toLowerCase();
    /** @type {Set<LineKind>} */
    const kinds = new Set();
    if (/award|honor|recognition/.test(w)) kinds.add("awards");
    else if (/achievement|accomplishment/.test(w)) kinds.add("highlights");
    if (/certif|licen/.test(w)) kinds.add("certifications");
    if (/language/.test(w)) kinds.add("languages");
    if (/skill|competenc|expertise|tools|technolog|tech stack/.test(w)) kinds.add("skills");
    if (/education|academic/.test(w)) kinds.add("education");
    if (/\b(?:projects|portfolio|publications)\b/.test(w)) kinds.add("projects");
    if (/experience|employment|work history|career history|positions/.test(w)) kinds.add("experience");
    if (/summary|profile|objective|about/.test(w)) kinds.add("summary");
    if (!kinds.size) kinds.add("other");
    return kinds;
  }

  /**
   * Items on a list line: "a, b; c | d". Parentheses stay whole, so
   * "Cloud (GCP, AWS)" is one item.
   * @param {string} line
   */
  function listItems(line) {
    /** @type {string[]} */
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of line) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if (depth === 0 && /[,;|•·]/.test(ch)) {
        out.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out
      .flatMap((item) => item.split(/\s+and\s+(?=[A-Z])/))
      .map((item) => cleanFact(item).replace(/[.]+$/, "").trim())
      .filter((item) => item.length > 0 && item.length <= 60);
  }

  /** @param {string} item */
  function isHumanLanguage(item) {
    return item
      .toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .split(/[^a-z]+/)
      .some((w) => HUMAN_LANGUAGES.has(w));
  }

  /**
   * @param {string} item
   * @param {string} label
   * @returns {SkillBucket}
   */
  function defaultBucket(item, label) {
    const l = label.toLowerCase();
    if (/soft|interpersonal|personal/.test(l) || SOFT_SKILL_RE.test(item)) return "soft";
    if (/tool|software|platform|stack|workflow|systems|cloud|languages?\b|technolog/.test(l)) return "tools";
    return "hard";
  }

  /** The first URL on a line, with a scheme, or "". @param {string} line */
  function urlOnLine(line) {
    const m = /\b((?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?)/i.exec(line);
    if (!m || /@/.test(line.slice(Math.max(0, m.index - 1), m.index))) return "";
    const hit = m[1];
    if (!/\//.test(hit) && !/\.(?:com|dev|io|app|org|net|ai|co|me|xyz|site|page)$/i.test(hit)) return "";
    return /^https?:\/\//i.test(hit) ? hit : `https://${hit}`;
  }

  /**
   * Read the resume's lists. Every string returned is a slice of the text.
   * @param {string} text
   * @returns {ResumeLists}
   */
  function readResumeLists(text) {
    /** @type {ResumeLists} */
    const out = {
      summary: "",
      skills: [],
      certifications: [],
      awards: [],
      languages: [],
      education: [],
      projects: [],
      projectLines: [],
      lines: [],
    };
    /** @type {string[]} */
    const summaryLines = [];
    /** @type {Set<LineKind>} */
    let kinds = new Set(["other"]);
    /** @param {string} item @param {string} label */
    const addSkill = (item, label) => {
      if (out.skills.some((s) => s.text.toLowerCase() === item.toLowerCase())) return;
      out.skills.push({ id: `skill-${out.skills.length + 1}`, text: item, bucket: defaultBucket(item, label) });
    };
    for (const rawLine of String(text || "").replace(/\r/g, "").split("\n")) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const heading = headingKinds(trimmed);
      if (heading) {
        kinds = heading;
        continue;
      }
      const bullet = LIST_BULLET_RE.test(trimmed);
      const line = bullet ? trimmed.replace(LIST_BULLET_RE, "").trim() : trimmed;
      out.lines.push({ text: line, kinds, bullet, dated: RANGE_TAIL_RE.test(line) });
      const labelMatch = LABEL_RE.exec(line);
      const label = labelMatch ? labelMatch[1].trim() : "";
      const rest = labelMatch ? labelMatch[2].trim() : line;
      const l = label.toLowerCase();

      if (kinds.has("summary")) {
        summaryLines.push(line);
        continue;
      }
      /* A labelled list says what it is, under any heading. */
      if (label && /certif|licen/.test(l)) {
        for (const item of /;/.test(rest) ? rest.split(/;\s*/) : listItems(rest)) {
          const c = cleanFact(item).replace(/[.]+$/, "");
          if (c) out.certifications.push(c);
        }
        continue;
      }
      if (label && /^languages?$/.test(l)) {
        for (const item of listItems(rest)) {
          if (isHumanLanguage(item)) out.languages.push(item);
          else if (kinds.has("skills")) addSkill(item, label);
        }
        continue;
      }
      if (label && (kinds.has("skills") || /skill|tool|technolog|software|stack/.test(l))) {
        for (const item of listItems(rest)) addSkill(item, label);
        continue;
      }
      if (kinds.has("skills")) {
        for (const item of listItems(rest)) {
          if (kinds.has("certifications") && CREDENTIAL_RE.test(item)) out.certifications.push(item);
          else addSkill(item, label);
        }
        continue;
      }
      if (kinds.has("certifications")) {
        for (const item of /;/.test(rest) ? rest.split(/;\s*/) : [rest]) {
          const c = cleanFact(item).replace(/[.]+$/, "");
          if (c) out.certifications.push(c);
        }
        continue;
      }
      if (kinds.has("languages")) {
        for (const item of listItems(rest)) if (isHumanLanguage(item)) out.languages.push(item);
        continue;
      }
      if (kinds.has("awards")) {
        const a = cleanFact(line).replace(/[.]+$/, "");
        if (a) out.awards.push(a);
        continue;
      }
      if (kinds.has("education")) {
        out.education.push(cleanFact(line));
        continue;
      }
      if (kinds.has("projects")) {
        out.projectLines.push(cleanFact(line));
        /* A project names itself at the start of its line. A lower-case
         * continuation or a sentence of description is not a project. */
        if (/^[a-z]/.test(line) || (/[.!?]$/.test(line) && line.split(/\s+/).length > 6)) continue;
        const head = cleanFact(line.split(/\s+[—–|-]\s+|:\s+|\s+\(/)[0]).replace(/\s*(?:https?:\/\/)?\S+\.\S+$/, "").trim();
        if (head && head.length <= 80) out.projects.push({ name: head, url: urlOnLine(line) });
      }
    }
    out.summary = cleanFact(summaryLines.join(" "), 1200);
    return out;
  }

  /**
   * Apply the model's skill labels to the parser's lists. resumeFacts may
   * hold only skill ids, under skills.hard / skills.tools / skills.soft;
   * every other string (a name, a title, a skill written out, an unknown
   * id) is dropped and counted.
   * @param {ResumeLists} lists
   * @param {unknown} rawFacts
   * @returns {{ skills: { hard: string[], tools: string[], soft: string[] }, dropped: number }}
   */
  function applyModelLabels(lists, rawFacts) {
    /** @type {Map<string, SkillBucket>} */
    const labels = new Map();
    const known = new Set(lists.skills.map((s) => s.id));
    let dropped = 0;
    /** @param {unknown} value @param {string} path */
    const walk = (value, path) => {
      if (typeof value === "string") {
        const bucket = /^skills\.(hard|tools|soft)$/.exec(path);
        if (bucket && known.has(value.trim())) {
          if (!labels.has(value.trim())) labels.set(value.trim(), /** @type {SkillBucket} */ (bucket[1]));
        } else if (value.trim()) {
          dropped += 1;
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 200)) walk(item, path);
        return;
      }
      if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key);
      }
    };
    if (isRecord(rawFacts)) walk(rawFacts, "");
    /** @type {{ hard: string[], tools: string[], soft: string[] }} */
    const skills = { hard: [], tools: [], soft: [] };
    for (const s of lists.skills) skills[labels.get(s.id) || s.bucket].push(s.text);
    return { skills, dropped };
  }

  /** Figures an achievement states, years excluded. @param {string} text */
  function metricTokens(text) {
    return (String(text || "").match(METRIC_TOKEN_RE) || [])
      .map((t) => t.replace(/\s+/g, ""))
      .filter((t) => !/^(?:19|20)\d\d$/.test(t) && (/[%$x+kKmMbB#]/.test(t) || /\d{2,}/.test(t.replace(/,/g, ""))));
  }

  /**
   * What the browser can say it read when it drafted with no server
   * (Grok review: direct-no-counts, direct-opens-employer, round 3): the
   * parser's lists, the model's skill labels, and achievements counted
   * from experience lines. With no structure parser here it names no
   * employer or role; `experienceChecked: false` tells the status line to
   * say so. Same shape as server/resume-read.mjs's record.
   * @param {string} text
   * @param {unknown} rawFacts
   * @param {{ provider: string, model: string } | null} by
   */
  function readFromResumeFacts(text, rawFacts, by) {
    const lists = readResumeLists(text);
    const { skills, dropped } = applyModelLabels(lists, rawFacts);
    const highlights = lists.lines
      .filter((l) => (l.kinds.has("experience") || l.kinds.has("highlights")) && !(l.dated && !l.bullet))
      .filter((l) => !LABEL_RE.test(l.text))
      .filter((l) => l.bullet || l.text.length >= 40 || metricTokens(l.text).length > 0)
      .map((l) => ({ text: l.text, metrics: metricTokens(l.text) }));
    /** @param {unknown[]} list */
    const count = (list) => list.length;
    return {
      version: 1,
      by: by && by.model ? { provider: String(by.provider || ""), model: String(by.model) } : null,
      experienceChecked: false,
      contact: { name: "", email: "", phone: "", location: "", links: [] },
      headline: "",
      summary: lists.summary,
      employers: [],
      highlights,
      skills,
      education: lists.education,
      certifications: lists.certifications,
      awards: lists.awards,
      projects: lists.projects,
      languages: lists.languages,
      counts: {
        employers: 0,
        roles: 0,
        achievements: count(highlights),
        withNumbers: highlights.filter((h) => h.metrics.length > 0).length,
        skills: skills.hard.length + skills.tools.length + skills.soft.length,
        education: count(lists.education),
        certifications: count(lists.certifications),
        awards: count(lists.awards),
        projects: count(lists.projects),
        languages: count(lists.languages),
        links: 0,
      },
      dropped,
    };
  }

  const api = {
    SYSTEM_PROMPT,
    resumeFactsOf,
    headingKinds,
    readResumeLists,
    applyModelLabels,
    readFromResumeFacts,
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
