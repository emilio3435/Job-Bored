/**
 * Materials Wave 1 (L1) — deterministic resume structure.
 *
 * Turns plain resume text into employers, the roles held at each one, and
 * the claims written under each role. It is the fallback for the model pass
 * in materials-resume-structure-model.mjs and the only parser when no model
 * is configured, so it has to cope with the shapes real uploads arrive in:
 *
 *   - no bullet markers at all (the flattened upload that gave 0 claims):
 *     inside an experience block, any prose line of 40+ chars is a claim;
 *   - headers whose only reliable anchor is the trailing date range
 *     ("Digital Sales Manager, Brightwave Media May 2021 – 2026"), in either
 *     "Title, Company" or "Company — Title" order;
 *   - an umbrella header ("Brightwave Media (formerly Tidewater Radio) — … Sep 2017 – 2026")
 *     followed by several role lines at that company or its former name, so
 *     promotions nest under one employer instead of becoming three;
 *   - EDUCATION lines, which become education claims and never employers;
 *   - PDF-wrapped bullets, whose continuation lines rejoin their bullet.
 *
 * Every string it returns is a verbatim slice of the input. Pure and
 * synchronous: no model, no network, no disk.
 */

/**
 * @typedef {object} StructureRole
 * @property {string} title
 * @property {string | null} start
 * @property {string | null} end
 */

/**
 * @typedef {object} StructureClaim
 * @property {string} text
 * @property {number | null} roleIndex index into the employer's roles
 */

/**
 * @typedef {object} StructureEmployer
 * @property {string} name
 * @property {string[]} aliases normalized names this employer answers to
 * @property {string} [location]
 * @property {string} [scope]
 * @property {string} [site]
 * @property {string | null} start
 * @property {string | null} end
 * @property {StructureRole[]} roles
 * @property {StructureClaim[]} claims
 */

/**
 * The last claim, while a wrapped continuation line may still extend it.
 * @typedef {{ push: (text: string) => void, text: () => string, bullet: boolean }} OpenClaim
 */

/**
 * @typedef {object} ResumeStructure
 * @property {"rules" | "model"} source
 * @property {StructureEmployer[]} employers
 * @property {string[]} education
 * @property {string[]} credentials
 * @property {string[]} looseClaims bullets outside any employer block
 */

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DATE = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])/(?:19|20)\\d{2}`;
const END = `${DATE}|present|current|now|today`;
const TAIL_LOCATION = "[A-Z][A-Za-z.' -]+,\\s*[A-Z]{2}|Remote|Hybrid|On-?site";
/* The date range every experience header ends with, optionally followed by
 * a location ("…, 2021-2025, Austin, TX"). */
const RANGE_TAIL_RE = new RegExp(
  `[\\s,;|·•(—–-]*\\(?(${DATE})\\s*(?:[–—-]+|to|until)\\s*(${END})\\)?(?:\\s*[,;|·•—–-]\\s*(${TAIL_LOCATION}))?\\s*$`,
  "i",
);
const OPEN_END_RE = /^(present|current|now|today)$/i;

export const BULLET_RE = /^\s*(?:[-•*·▪●◦‣⁃➢■]|\d+[.)])\s+/;
const SECTION_CAPS_RE = /^[A-Z][A-Z\s&/]{2,40}$/;
const SECTION_WORDS_RE =
  /^(?:professional |work |relevant |earlier |additional |selected )?(?:experience|employment(?: history)?|work history|career history|education|skills|technical skills|summary|profile|certifications?|projects|awards|languages)$/i;

const TITLE_RE =
  /\b(?:manager|director|engineer|developer|co-?founder|founder|strategist|analyst|lead|head|vp|vice president|president|officer|chief|specialist|coordinator|consultant|associate|executive|representative|intern|designer|architect|scientist|owner|supervisor|administrator|advisor|adviser|assistant|principal|researcher|editor|writer|producer|planner|buyer|recruiter|ceo|cto|coo|cmo|cfo|cro|svp|evp|avp|technician|teacher|professor|instructor|trainer|attorney|accountant|controller|programmer|marketer|fellow|contractor|freelancer)s?\b/i;
const LOCATION_RE = /^(?:[A-Z][A-Za-z.' -]+,\s*[A-Z]{2}(?:\s+\d{5})?|remote|hybrid)$/i;
const DEGREE_RE =
  /\b(?:bachelor|master|mba|ph\.?\s?d|doctor of|associate of|associate's|diploma|b\.\s?[as]\.?|m\.\s?[as]\.?|b\.?sc|m\.?sc)\b/i;
const SCHOOL_RE = /\b(?:university|college|school|institute|academy|polytechnic)\b/i;
const CORP_SUFFIX_RE = /^(?:inc|llc|ltd|co|corp|gmbh|plc|l\.l\.c)\.?$/i;
const ALIAS_PAREN_RE =
  /\((?:formerly|previously|now|fka|f\/k\/a|aka|a\.k\.a\.|acquired by|part of)\s+([^)]+)\)/gi;
/* Inside an umbrella employer, a department after the comma belongs to the
 * title ("Vice President, Operations"), never a company of its own. Outside
 * one, "Director, Engineering" keeps its title/company split. */
const DEPARTMENT_RE =
  /^(?:operations|sales|digital sales|marketing|engineering|product|finance|growth|strategy|partnerships|design|data|research|legal|communications|people|human resources|hr|it|technology|customer success|business development|revenue|analytics|security|infrastructure|platform)$/i;
/* A header segment that is only a former-name clause. */
const FORMERLY_SEG_RE = /^(?:formerly|previously|fka|f\/k\/a|aka|a\.k\.a\.)\s+(.+)$/i;
/* "Contoso Health, formerly Litware Clinics" (comma or dash, no parentheses). */
export const ALIAS_CLAUSE_RE = /(?:,|\s[—–-])\s*(?:formerly|previously|fka|f\/k\/a|aka|a\.k\.a\.)\s+([^,()]+?)\s*$/i;
const DOMAIN_PAREN_RE = /\(\s*((?:[a-z0-9-]+\.)+[a-z]{2,})\s*\)/i;
const TERMINAL_RE = /[.!?;]["”’')\]]?$/;

/* A date range alone on its line ("Mar 2015 – May 2018"). */
const BARE_RANGE_RE = new RegExp(`^\\(?(${DATE})\\s*(?:[–—-]+|to|until)\\s*(${END})\\)?$`, "i");
/* A short line that still states a figure: %, $, a multiplier, or a
 * number that is not a year. */
const SHORT_METRIC_RE = /(?:\d%|\$\s?\d|\b\d+(?:\.\d+)?x\b|\b(?!(?:19|20)\d\d\b)\d{2,}\b)/;

/**
 * A job title on its own line: reads as a title, a few words, no figures,
 * no sentence punctuation.
 * @param {string} s
 */
function isTitleOnly(s) {
  return (
    TITLE_RE.test(s) &&
    s.length <= 60 &&
    s.split(/\s+/).length <= 6 &&
    !/\d/.test(s) &&
    !/[.!?:;,]$/.test(s)
  );
}

/** Prose inside an experience block becomes a claim from this length. */
export const MIN_PROSE_CLAIM_CHARS = 40;

/** @param {unknown} value */
function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Lowercase, punctuation-light key for comparing company names.
 * @param {string} name
 */
export function normalizeName(name) {
  return clean(name)
    .toLowerCase()
    .replace(/[.,'’"“”]/g, "")
    .replace(/\s+(?:inc|llc|ltd|co|corp|gmbh|plc)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The names a company header answers to: the full name, the name without
 * its parentheticals, and any "(formerly X)" / "(now X)" alias.
 * @param {string} name
 */
export function aliasesFor(name) {
  const out = new Set();
  const full = normalizeName(name);
  if (full) out.add(full);
  const base = normalizeName(name.replace(/\([^)]*\)/g, " "));
  if (base) out.add(base);
  for (const m of name.matchAll(ALIAS_PAREN_RE)) {
    const alias = normalizeName(m[1]);
    if (alias) out.add(alias);
  }
  const clause = ALIAS_CLAUSE_RE.exec(name);
  if (clause) {
    const head = normalizeName(name.slice(0, clause.index));
    const alias = normalizeName(clause[1]);
    if (head) out.add(head);
    if (alias) out.add(alias);
  }
  return [...out];
}

/**
 * @param {string} line trimmed line
 * @returns {"experience" | "education" | "credentials" | "skip" | "summary" | "other" | null}
 */
export function sectionKind(line) {
  const t = line.replace(/[:\s]+$/, "");
  if (!(SECTION_CAPS_RE.test(t) || SECTION_WORDS_RE.test(t))) return null;
  if (/EDUCATION|ACADEMIC/i.test(t)) return "education";
  /* Recognition is an award, never an achievement (Grok review, round 3). */
  if (/CERTIF|LICENS|AWARD|HONOR|RECOGNITION/i.test(t)) return "credentials";
  if (/EXPERIENCE|EMPLOYMENT|WORK HISTORY|CAREER|POSITIONS/i.test(t)) return "experience";
  if (/SKILL|COMPETENC|LANGUAGE|INTEREST|TOOLS|TECHNOLOG|REFERENCE|CONTACT/i.test(t)) return "skip";
  if (/SUMMARY|PROFILE|OBJECTIVE|ABOUT/i.test(t)) return "summary";
  return "other";
}

/** @param {string} s */
function isDescription(s) {
  return (
    s.length >= MIN_PROSE_CLAIM_CHARS &&
    s.split(/\s+/).length >= 6 &&
    (/[.!?]$/.test(s) || /[.!?]\s+[A-Z]/.test(s))
  );
}

/**
 * Split "Title, Company" (or "Company, Title") at the last comma that is
 * not a corporate suffix. Returns null when neither side reads as a title.
 * @param {string} s
 * @param {boolean} [inUmbrella] an umbrella employer is open
 */
function splitTitleCompany(s, inUmbrella = false) {
  const parts = s.split(/,\s+/);
  for (let k = parts.length - 1; k >= 1; k -= 1) {
    if (CORP_SUFFIX_RE.test(parts[k])) continue;
    const left = parts.slice(0, k).join(", ");
    const right = parts.slice(k).join(", ");
    if (inUmbrella && DEPARTMENT_RE.test(right) && TITLE_RE.test(left)) return { title: s, name: "" };
    const lt = TITLE_RE.test(left);
    const rt = TITLE_RE.test(right);
    if (lt && !rt) return { title: left, name: right };
    if (rt && !lt) return { title: right, name: left };
    return null;
  }
  return null;
}

/**
 * Parse one line as an experience header. The trailing date range is the
 * anchor; the text before it splits into title, company, location, scope
 * and (for one-line "earlier" entries) a description sentence.
 * @param {string} line
 * @param {{ inUmbrella?: boolean }} [context]
 */
export function parseHeaderLine(line, context = {}) {
  const inUmbrella = Boolean(context.inUmbrella);
  const m = RANGE_TAIL_RE.exec(line);
  if (!m) return null;
  const head = line.slice(0, m.index).replace(/[\s,;|·•(—–-]+$/, "");
  if (!head) return null;
  const segs = head
    .split(/\s+(?:[—–|]|-{1,2})\s+/)
    .map((s) => s.replace(/^[\s,;·•|]+|[\s,;·•|]+$/g, ""))
    .filter(Boolean);
  if (!segs.length) return null;
  if (isDescription(segs[0]) && !(segs[0].includes(", ") && splitTitleCompany(segs[0], inUmbrella))) return null;

  let title = "";
  let name = "";
  let location = "";
  let scope = "";
  let description = "";
  let former = "";
  let cursor = 0;
  for (const seg of segs) {
    /* "Contoso Health — formerly Litware Clinics — Tucson, AZ": the clause
     * is the company's former name, not a scope or a title. */
    const formerly = FORMERLY_SEG_RE.exec(seg);
    if (formerly) {
      if (!former) former = formerly[1].trim();
      continue;
    }
    const at = head.indexOf(seg, cursor);
    cursor = at >= 0 ? at + seg.length : cursor;
    if ((name || title) && isDescription(seg)) {
      description = head.slice(at >= 0 ? at : 0).trim();
      break;
    }
    if (LOCATION_RE.test(seg)) {
      if (!location) location = seg;
      continue;
    }
    if (!title && !name && seg.includes(", ")) {
      const split = splitTitleCompany(seg, inUmbrella);
      if (split) {
        title = split.title;
        name = split.name;
        continue;
      }
    }
    const atMatch = !title && !name ? /^(.+?)\s+(?:at|@)\s+(.+)$/.exec(seg) : null;
    if (atMatch && TITLE_RE.test(atMatch[1])) {
      title = atMatch[1];
      name = atMatch[2];
      continue;
    }
    if (!title && TITLE_RE.test(seg)) {
      title = seg;
      continue;
    }
    if (!name) {
      name = seg;
      continue;
    }
    if (!scope) scope = seg;
  }
  /* A company is a short name, never a sentence. */
  const sentence = /[.!?]$/.test(name) && !/\b(?:inc|ltd|co|corp|llc)\.$/i.test(name) && name.length > 30;
  if (name && (name.length > 80 || name.split(/\s+/).length > 10 || sentence)) {
    return null;
  }
  if (!name && !title) return null;
  if (former && name) name = `${name} (formerly ${former})`;
  if (m[3] && !location) location = m[3];
  const start = m[1];
  const end = OPEN_END_RE.test(m[2]) ? null : m[2];
  return { title, name, location, scope, description, start, end };
}

/**
 * @param {{ title: string, name: string }} header
 */
function isEducationHeader(header) {
  return SCHOOL_RE.test(header.name) || DEGREE_RE.test(header.title) || DEGREE_RE.test(header.name);
}

/** @param {string | null} date */
function yearOf(date) {
  const m = /(19|20)\d{2}/.exec(date || "");
  return m ? Number(m[0]) : null;
}

/**
 * @param {StructureEmployer} employer
 * @param {boolean} umbrellaDated
 */
function settleDates(employer, umbrellaDated) {
  if (umbrellaDated || !employer.roles.length) return;
  let start = employer.roles[0].start;
  for (const role of employer.roles) {
    const y = yearOf(role.start);
    const cur = yearOf(start);
    if (y !== null && (cur === null || y < cur)) start = role.start;
  }
  const open = employer.roles.some((r) => r.end === null);
  let end = open ? null : employer.roles[0].end;
  if (!open) {
    for (const role of employer.roles) {
      const y = yearOf(role.end);
      const cur = yearOf(end);
      if (y !== null && (cur === null || y > cur)) end = role.end;
    }
  }
  employer.start = start;
  employer.end = end;
}

/**
 * Parse resume text into employers, roles and claims.
 * @param {string} resumeText
 * @returns {ResumeStructure}
 */
export function parseResumeStructure(resumeText) {
  /** @type {StructureEmployer[]} */
  const employers = [];
  /** @type {Set<StructureEmployer>} */
  const umbrellaDated = new Set();
  /** @type {string[]} */
  const education = [];
  /** @type {string[]} */
  const credentials = [];
  /** @type {string[]} */
  const looseClaims = [];

  /** @type {string} */
  let section = "";
  /** @type {StructureEmployer | null} */
  let current = null;
  /** @type {StructureEmployer | null} */
  let umbrella = null;
  let roleIndex = /** @type {number | null} */ (null);
  /* The last claim, while a wrapped continuation may still extend it. */
  /** @type {OpenClaim | null} */
  let openClaim = null;
  let lineIsBullet = false;
  /** @type {StructureRole | null} a title-only role waiting for its dates */
  let datelessRole = null;

  /** @param {string} name */
  const findEmployer = (name) => {
    const keys = aliasesFor(name);
    return employers.find((e) => e.aliases.some((a) => keys.includes(a))) || null;
  };

  /**
   * @param {string[]} list
   * @param {string} text
   * @returns {OpenClaim}
   */
  const pushTo = (list, text) => {
    list.push(text);
    const i = list.length - 1;
    return {
      push: (more) => {
        list[i] = `${list[i]} ${more}`;
      },
      text: () => list[i],
      bullet: lineIsBullet,
    };
  };

  /**
   * @param {StructureEmployer} employer
   * @param {string} text
   * @returns {OpenClaim}
   */
  const pushClaim = (employer, text) => {
    const claim = { text, roleIndex };
    employer.claims.push(claim);
    return {
      push: (more) => {
        claim.text = `${claim.text} ${more}`;
      },
      text: () => claim.text,
      bullet: lineIsBullet,
    };
  };

  for (const raw of String(resumeText || "").split("\n")) {
    const line = clean(raw);
    if (!line) {
      openClaim = null;
      continue;
    }
    const kind = sectionKind(line);
    if (kind) {
      section = kind;
      umbrella = null;
      current = null;
      roleIndex = null;
      openClaim = null;
      continue;
    }
    const bullet = BULLET_RE.test(line);
    lineIsBullet = bullet;
    const text = bullet ? clean(line.replace(BULLET_RE, "")) : line;
    if (!text) continue;

    if (section === "skip") continue;
    if (section === "education") {
      if (openClaim && !bullet && /^[a-z]/.test(text)) openClaim.push(text);
      else openClaim = pushTo(education, text);
      continue;
    }
    if (section === "credentials") {
      openClaim = pushTo(credentials, text);
      continue;
    }

    if (!bullet) {
      const header = parseHeaderLine(text, { inUmbrella: Boolean(umbrella) });
      if (header) {
        openClaim = null;
        if (isEducationHeader(header)) {
          education.push(text);
          continue;
        }
        if (!header.name) {
          /* A title-only line inside an employer block is another role there. */
          /** @type {StructureEmployer | null} */
          const host = umbrella || current;
          if (!host) continue;
          host.roles.push({ title: header.title, start: header.start, end: header.end });
          current = host;
          roleIndex = host.roles.length - 1;
          continue;
        }
        const keys = aliasesFor(header.name);
        /** @type {StructureEmployer | null} */
        let employer =
          umbrella && umbrella.aliases.some((a) => keys.includes(a)) ? umbrella : findEmployer(header.name);
        if (umbrella && employer !== umbrella) umbrella = null;
        if (!employer) {
          const domain = DOMAIN_PAREN_RE.exec(header.name);
          const display = domain ? clean(header.name.replace(DOMAIN_PAREN_RE, " ")) : header.name;
          employer = {
            name: display,
            aliases: aliasesFor(display),
            ...(domain ? { site: domain[1] } : {}),
            start: null,
            end: null,
            roles: [],
            claims: [],
          };
          employers.push(employer);
        }
        if (header.location && !employer.location) employer.location = header.location;
        if (header.title) {
          employer.roles.push({ title: header.title, start: header.start, end: header.end });
          roleIndex = employer.roles.length - 1;
        } else {
          /* Company-only header: an umbrella its role lines nest under. */
          employer.start = header.start;
          employer.end = header.end;
          umbrellaDated.add(employer);
          if (header.scope && !employer.scope) employer.scope = header.scope;
          umbrella = employer;
          roleIndex = null;
        }
        current = employer;
        if (header.description) openClaim = pushClaim(employer, header.description);
        continue;
      }
    }

    /* A wrapped continuation of the previous bullet rejoins it. */
    if (
      !bullet &&
      openClaim &&
      !TERMINAL_RE.test(openClaim.text()) &&
      (openClaim.bullet || /^[a-z]/.test(text))
    ) {
      openClaim.push(text);
      continue;
    }
    if (bullet) {
      if (current) openClaim = pushClaim(current, text);
      else if (section !== "summary" || text.length >= MIN_PROSE_CLAIM_CHARS) openClaim = pushTo(looseClaims, text);
      continue;
    }
    openClaim = null;
    if (current && isTitleOnly(text)) {
      /* "Operations Manager" alone on its line: a role here, dated by a bare
       * range on the next line when there is one. */
      const role = { title: text, start: null, end: null };
      current.roles.push(role);
      roleIndex = current.roles.length - 1;
      datelessRole = role;
      continue;
    }
    const bare = BARE_RANGE_RE.exec(text);
    if (bare) {
      if (datelessRole && datelessRole.start === null) {
        datelessRole.start = bare[1];
        datelessRole.end = OPEN_END_RE.test(bare[2]) ? null : bare[2];
      }
      datelessRole = null;
      continue;
    }
    datelessRole = null;
    /* Prose from 40 characters, or a shorter line that states a number
     * ("Grew revenue 40%."). */
    if (current && (text.length >= MIN_PROSE_CLAIM_CHARS || SHORT_METRIC_RE.test(text))) {
      openClaim = pushClaim(current, text);
    }
  }

  for (const employer of employers) settleDates(employer, umbrellaDated.has(employer));
  return { source: "rules", employers, education, credentials, looseClaims };
}

/** @param {string} name */
export function slugify(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "employer";
}

/**
 * The structured `experiences[]` block profile.json carries, so later ledger
 * builds read employers, titles and dates instead of re-deriving them.
 * @param {ResumeStructure} structure
 */
export function experiencesFromStructure(structure) {
  return structure.employers.slice(0, 24).map((e) => {
    const title = e.roles[0]?.title || "";
    return {
      slug: slugify(e.name),
      company: e.name.slice(0, 120),
      ...(title ? { title: title.slice(0, 160) } : {}),
      ...(e.location ? { location: e.location } : {}),
      ...(e.site ? { site: e.site } : {}),
      start: e.start,
      end: e.end,
      roles: e.roles.map((r) => ({ title: r.title.slice(0, 160), start: r.start, end: r.end })),
    };
  });
}
