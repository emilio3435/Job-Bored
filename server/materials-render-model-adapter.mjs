/**
 * TEMPORARY ADAPTER: today's writer JSON → materials.render-model.v1.
 *
 * The template registry (plan slice 3) renders only render models, but the
 * drafter's writer still returns the v2 shape ({ letter: { hook, whyThem,
 * … }, resume: { header, summary, roles, education, skills } }). This module
 * maps that JSON, the user's own resume text and the brand-logo resolver's
 * marks into a render model, as far as the data supports, so the registry
 * renders real packages today.
 *
 * It is a bridge, not the pipeline. BEAUDIT wave 2 lane "M" builds PR #120's
 * claim-ledger pipeline (the ledger, the three narrow AI calls and the
 * cache) and replaces this adapter's input with that pipeline's output.
 * Until then:
 *   - claim ids are synthetic (`<employerId>-<n>`), because there is no
 *     ledger to point at;
 *   - a number is typeset as a metric run only when the same token appears
 *     verbatim in the user's own resume text, the nearest thing to a ledger
 *     metric this data has;
 *   - readouts, letter readouts and the pull quote are picked
 *     deterministically from those traced figures and verbatim sentences;
 *     editorial's `intro` and `headline` are left out (they need a drafting
 *     prompt), and each family renders acceptably without them (§8).
 *
 * No facts are invented here: every string comes from the writer JSON, the
 * resume text, the request, or the logo resolver.
 */

import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { candidateNameFromText } from "./materials-resume-source.mjs";
import { templateIdsFor } from "./materials-templates.mjs";

/**
 * @typedef {import("./materials-render.mjs").RenderModel} RenderModel
 * @typedef {import("./materials-render.mjs").Run} Run
 * @typedef {import("./materials-render.mjs").Entry} Entry
 * @typedef {import("./materials-render.mjs").Section} Section
 * @typedef {import("./materials-render.mjs").Readout} Readout
 */

/**
 * @typedef {object} ResolvedMark
 * @property {string} slug
 * @property {string} label
 * @property {string} [domain]
 * @property {string} src
 * @property {string} alt
 * @property {"mark" | "wordmark" | "lockup"} shape
 * @property {"upload" | "favicon" | "monogram"} [source]
 */

/**
 * @typedef {object} AdapterInput
 * @property {unknown} writerJson
 * @property {string} resumeText the user's own resume, the source of facts
 * @property {{ company?: string, title?: string }} [request]
 * @property {{ id: string, version: string }} family
 * @property {ResolvedMark[]} [marks]
 * @property {string} [nowIso]
 */

const LETTER_FIELDS = ["hook", "whyThem", "whyMe", "whyNow", "closing", "flourish"];
const BEATS_FOR = {
  3: ["thesis", "analytics-proof", "next-step"],
  4: ["thesis", "analytics-proof", "ai-ops-proof", "next-step"],
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function str(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** @param {unknown} value */
function strList(value) {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}

/** @param {string} value */
export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ------------------------------------------------------------------ *
 * Contact
 * ------------------------------------------------------------------ */

/**
 * @param {string} text
 * @returns {{ kind: "location" | "phone" | "email" | "site" | "linkedin" | "other", text: string, href?: string }}
 */
export function classifyContact(text) {
  const t = text.trim();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t)) return { kind: "email", text: t, href: `mailto:${t}` };
  if (/linkedin\.com\//i.test(t)) {
    return { kind: "linkedin", text: t.replace(/^https?:\/\/(www\.)?/i, ""), href: /^https?:/i.test(t) ? t : `https://${t}` };
  }
  if (/^\+?[\d().\s-]{7,}$/.test(t) && (t.match(/\d/g) || []).length >= 7) return { kind: "phone", text: t };
  if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(t)) {
    return { kind: "site", text: t.replace(/^https?:\/\/(www\.)?/i, ""), href: /^https?:/i.test(t) ? t : `https://${t}` };
  }
  if (/,/.test(t) || /\b[A-Z]{2}\b/.test(t)) return { kind: "location", text: t };
  return { kind: "other", text: t };
}

/**
 * Contact lines from the writer's header, else from the resume text itself.
 * @param {string[]} headerContact
 * @param {string} resumeText
 */
function contactFrom(headerContact, resumeText) {
  const items = headerContact.map(classifyContact);
  if (!items.some((c) => c.kind === "email")) {
    const email = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i.exec(resumeText);
    if (email) items.push(classifyContact(email[0]));
  }
  if (!items.some((c) => c.kind === "phone")) {
    const phone = /(\+?\d[\d().\s-]{6,}\d)/.exec(resumeText.split("\n").slice(0, 8).join("\n"));
    if (phone && (phone[1].match(/\d/g) || []).length >= 7) items.push({ kind: "phone", text: phone[1].trim() });
  }
  if (!items.some((c) => c.kind === "linkedin")) {
    const li = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w-]+/i.exec(resumeText);
    if (li) items.push(classifyContact(li[0]));
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * Metric runs, traced to the user's resume
 * ------------------------------------------------------------------ */

const METRIC_RE = /(?<![\w$#.])((?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?)(?![\w%])/g;

/** @param {string} token */
function isYear(token) {
  return /^(19|20)\d{2}$/.test(token) || /^(19|20)\d{2}[–-](19|20)?\d{2}$/.test(token);
}

/**
 * Split a sentence into runs, setting a number as an `n` run only when that
 * exact token appears in the user's resume (never a year).
 *
 * @param {string} text
 * @param {string} resumeText
 * @returns {Run[]}
 */
export function tagMetrics(text, resumeText) {
  /** @type {Run[]} */
  const runs = [];
  let last = 0;
  for (const match of text.matchAll(METRIC_RE)) {
    const token = match[1];
    const start = /** @type {number} */ (match.index);
    if (isYear(token) || !resumeText.includes(token)) continue;
    if (start > last) runs.push({ t: text.slice(last, start) });
    runs.push({ n: token });
    last = start + token.length;
  }
  if (last < text.length) runs.push({ t: text.slice(last) });
  return runs.length ? runs : [{ t: text }];
}

const CAPTION_STOP_WORDS = new Set(["a", "an", "the", "of", "and", "to", "by", "for", "with", "in", "on", "at", "from", "into"]);
const CAPTION_LEAD_BEFORE = /^(by|through|via|while|so|which|that|when|after|before)\b/i;

/** @param {string[]} words */
function trimStopWords(words) {
  const out = [...words];
  while (out.length && CAPTION_STOP_WORDS.has(out[out.length - 1].toLowerCase())) out.pop();
  return out;
}

/**
 * A short caption for a figure, in the bullet's own words (verbatim, never
 * rephrased): the words after the figure up to the end of its clause, the
 * next figure or an "and", at most five; or, when the clause after the
 * figure only explains how ("by rebuilding…"), the words before it.
 *
 * @param {Run[]} runs
 * @param {number} index position of the `n` run
 */
function captionFor(runs, index) {
  const after = runs.slice(index + 1).map((r) => (typeof r.n === "string" ? " \u0000 " : r.t ?? r.hl ?? "")).join("");
  const clauseAfter = after.split(/[.;:,()\u2014\u2013\u0000]/)[0].trim();
  const before = runs.slice(0, index).map((r) => (typeof r.n === "string" ? " \u0000 " : r.t ?? r.hl ?? "")).join("");
  const clauseBefore = (before.split(/[.;:,()\u2014\u2013\u0000]/).pop() || "").trim();
  const beforeWords = trimStopWords(clauseBefore.split(/\s+/).filter(Boolean)).slice(-5);
  if (CAPTION_LEAD_BEFORE.test(clauseAfter) && beforeWords.length >= 2) return beforeWords.join(" ");
  /** @type {string[]} */
  const afterWords = [];
  for (const word of clauseAfter.split(/\s+/).filter(Boolean)) {
    if (word.toLowerCase() === "and" || /\d/.test(word) || afterWords.length >= 5) break;
    afterWords.push(word);
  }
  const trimmed = trimStopWords(afterWords);
  if (trimmed.length >= 1 && !CAPTION_STOP_WORDS.has(trimmed[0].toLowerCase())) return trimmed.join(" ");
  if (trimmed.length >= 2) return trimmed.join(" ");
  if (beforeWords.length >= 2) return beforeWords.join(" ");
  return "";
}

/* ------------------------------------------------------------------ *
 * Logos
 * ------------------------------------------------------------------ */

/**
 * @param {ResolvedMark[]} marks
 * @param {{ employerId: string, org: string }} target
 * @returns {import("./materials-render.mjs").Logo | undefined}
 */
export function matchMark(marks, { employerId, org }) {
  const orgSlug = slugify(org);
  const mark = marks.find((m) => {
    const labelSlug = slugify(m.label || "");
    return (
      m.slug === employerId ||
      m.slug === orgSlug ||
      (labelSlug && labelSlug === orgSlug) ||
      (labelSlug.length >= 4 && (orgSlug.startsWith(`${labelSlug}-`) || orgSlug === labelSlug)) ||
      (m.slug.length >= 4 && orgSlug.startsWith(`${m.slug}-`))
    );
  });
  if (!mark) return undefined;
  /** @type {import("./materials-render.mjs").Logo} */
  const logo = { src: mark.src, alt: mark.alt || `${org} logo`, shape: mark.shape };
  if (mark.source) logo.source = mark.source;
  return logo;
}

/* ------------------------------------------------------------------ *
 * Resume
 * ------------------------------------------------------------------ */

/**
 * @param {Record<string, unknown>} resume
 * @param {string} resumeText
 * @param {ResolvedMark[]} marks
 * @returns {{ sections: Section[], featured: Entry[] }}
 */
function resumeSections(resume, resumeText, marks) {
  const hard = MATERIALS_BUDGETS.resume;
  const roles = Array.isArray(resume.roles) ? resume.roles.filter(isRecord) : [];
  /** @type {Entry[]} */
  const featured = [];
  /** @type {Entry[]} */
  const earlier = [];
  const usedIds = new Set();
  roles.forEach((role, index) => {
    const org = str(role.company) || str(role.title) || `Role ${index + 1}`;
    let employerId = slugify(str(role.id) || org) || `role-${index + 1}`;
    while (usedIds.has(employerId)) employerId = `${employerId}-${index + 1}`;
    usedIds.add(employerId);
    const meta = [str(role.dates), str(role.location)].filter(Boolean);
    const bulletsText = strList(role.bullets);
    /** @type {Entry} */
    const entry = { employerId, meta, org };
    const seat = str(role.title);
    if (seat && seat !== org) entry.seat = tagMetrics(seat, resumeText);
    const logo = matchMark(marks, { employerId, org });
    if (logo) entry.logo = logo;
    if (featured.length < hard.featuredEmployersMax) {
      if (bulletsText.length >= hard.bulletsPerFeatured[0]) {
        entry.bullets = bulletsText.slice(0, hard.bulletsPerFeatured[1]).map((text, i) => ({
          claimId: `${employerId}-${i + 1}`,
          runs: tagMetrics(text, resumeText),
        }));
      } else if (bulletsText.length === 1) {
        entry.line = bulletsText[0];
        entry.claimId = `${employerId}-1`;
      }
      featured.push(entry);
    } else {
      if (bulletsText.length) {
        entry.line = bulletsText[0];
        entry.claimId = `${employerId}-1`;
      }
      earlier.push(entry);
    }
  });

  /** @type {Section[]} */
  const sections = [];
  const readouts = pickReadouts(featured, MATERIALS_BUDGETS.resume.featuredEmployersMax * 2);
  if (readouts.length >= 3) sections.push({ kind: "readouts", label: "Verified figures", readouts });
  if (featured.length) sections.push({ kind: "experience", label: "Experience", entries: featured });
  if (earlier.length) sections.push({ kind: "earlier", label: "Earlier", entries: earlier });

  const skills = strList(resume.skills).length ? strList(resume.skills) : strList(resume.capabilitiesOrder);
  if (skills.length) {
    sections.push({ kind: "tokens", label: "Skills", tokens: skills.slice(0, hard.tokens[1]) });
  }
  const education = strList(resume.education);
  if (education.length) {
    sections.push({
      kind: "credentials",
      label: "Education",
      lines: education.map((line) => {
        /** @type {{ runs: Run[], logo?: import("./materials-render.mjs").Logo }} */
        const out = { runs: [{ t: line }] };
        const school = line.split(/,|—|–|\|/).map((s) => s.trim()).find((part) => /universit|college|school|institut|academy/i.test(part));
        const logo = school ? matchMark(marks, { employerId: slugify(school), org: school }) : undefined;
        if (logo) out.logo = logo;
        return out;
      }),
    });
  }
  return { sections, featured };
}

/**
 * Up to `max` traced figures from the featured bullets, at most three per
 * employer, each captioned in the bullet's own words.
 *
 * @param {Entry[]} featured
 * @param {number} max
 * @returns {Readout[]}
 */
function pickReadouts(featured, max) {
  /** @type {Readout[]} */
  const picked = [];
  const seen = new Set();
  for (const entry of featured) {
    let perEmployer = 0;
    for (const bullet of entry.bullets || []) {
      bullet.runs.forEach((run, index) => {
        if (typeof run.n !== "string" || picked.length >= max || perEmployer >= 3) return;
        if (seen.has(run.n) || run.n.replace(/\D/g, "").length === 0) return;
        const caption = captionFor(bullet.runs, index);
        if (!caption) return;
        seen.add(run.n);
        perEmployer += 1;
        picked.push({ n: run.n, caption, claimId: bullet.claimId, employerId: entry.employerId });
      });
    }
  }
  return picked;
}

/* ------------------------------------------------------------------ *
 * Letter
 * ------------------------------------------------------------------ */

/** @param {string} iso */
function longDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** @param {string} text */
function sentences(text) {
  return text.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim()) || [];
}

/**
 * @param {Record<string, unknown>} letter
 * @param {{ company?: string, title?: string }} request
 * @param {Readout[]} resumeReadouts
 * @param {string} nowIso
 */
function letterDoc(letter, request, resumeReadouts, nowIso) {
  const parts = LETTER_FIELDS.map((field) => str(letter[field])).filter(Boolean);
  /** @type {string[]} */
  let paragraphs = parts;
  if (parts.length > 4) {
    paragraphs = [parts[0], parts[1], parts.slice(2, parts.length - 1).join(" "), parts[parts.length - 1]];
  }
  const beats = BEATS_FOR[/** @type {3 | 4} */ (paragraphs.length)] || BEATS_FOR[4];
  const manager = str(letter.hiringManager);
  const company = str(letter.company) || str(request.company);
  const role = str(letter.role) || str(request.title);
  /** @type {{ label: string, lines: string[] }[]} */
  const rail = [];
  const to = [manager || "Hiring team", company, str(letter.companyAddr)].filter(Boolean);
  rail.push({ label: "To", lines: to });
  if (role) rail.push({ label: "Re", lines: [role] });
  const date = str(letter.date) || longDate(nowIso);
  if (date) rail.push({ label: "Date", lines: [date] });

  const body = paragraphs.map((text, index) => ({
    id: `p${index + 1}`,
    beat: beats[Math.min(index, beats.length - 1)],
    text,
  }));
  /** @type {import("./materials-render.mjs").LetterDoc} */
  const doc = {
    templateId: "",
    rail,
    railRule: "restated-metadata-only",
    salutation: `Dear ${manager || "hiring team"},`,
    paragraphs: body,
    signoff: "Best,",
  };
  const letterText = paragraphs.join(" ");
  const letterReadouts = resumeReadouts.filter((r) => letterText.includes(r.n)).slice(0, 4);
  if (letterReadouts.length >= 2) doc.readouts = letterReadouts;
  const third = body[2];
  if (third) {
    const quote = sentences(third.text).filter((s) => {
      const words = s.split(/\s+/).length;
      return words >= 8 && words <= 26;
    }).pop();
    if (quote) doc.pullQuote = { text: quote, fromParagraph: third.id };
  }
  if (company || role) doc.foot = { left: ["Cover letter", company, role].filter(Boolean).join(" · ") };
  return doc;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Build the render model from the v3 pipeline: draft slots, outline,
 * selection and ledger. Claim ids are the ledger's own; metric runs
 * trace to ledger claim text (never the resume at large); identity comes
 * from the user's resume text.
 *
 * @param {object} input
 * @param {Record<string, unknown>} input.draft materials.draft.v1
 * @param {{ featured?: Array<{ employerId?: unknown, claimIds?: unknown[] }>, earlier?: unknown[], toolsLine?: unknown[] }} input.outline
 * @param {{ employers?: Array<{ id?: unknown, name?: unknown, title?: unknown, location?: unknown }>, claims?: Array<{ id?: unknown, employerId?: unknown, text?: unknown }> }} input.ledger
 * @param {string} [input.resumeText] the user's own resume, for identity + contact
 * @param {{ company?: unknown, title?: unknown }} [input.request]
 * @param {import("./materials-templates.mjs").TemplateFamily} input.family
 * @param {ResolvedMark[]} [input.marks]
 * @param {string} [input.nowIso]
 * @returns {RenderModel}
 */
export function buildRenderModelFromDraft({ draft, outline, ledger, resumeText = "", request = {}, family, marks = [], nowIso }) {
  const source = String(resumeText || "");
  const claims = new Map(
    (ledger.claims || []).filter(isRecord).map((c) => [c.id, c]),
  );
  const employers = new Map(
    (ledger.employers || []).filter(isRecord).map((e) => [e.id, e]),
  );
  /* Metric membership corpus: the ledger's own claim texts. */
  const corpus = [...claims.values()].map((c) => str(c.text)).join("\n");
  const name = candidateNameFromText(source) || "Candidate";
  const target = str(request.title) || "Candidate";
  const ids = templateIdsFor(family);

  const bulletsById = new Map();
  for (const bullet of Array.isArray(draft.bullets) ? draft.bullets : []) {
    if (isRecord(bullet) && typeof bullet.claimId === "string") bulletsById.set(bullet.claimId, str(bullet.text));
  }
  const earlierById = new Map();
  for (const line of Array.isArray(draft.earlier) ? draft.earlier : []) {
    if (isRecord(line) && typeof line.claimId === "string") earlierById.set(line.claimId, str(line.text));
  }

  /** @type {Entry[]} */
  const featured = [];
  for (const group of outline.featured || []) {
    const employerId = str(group.employerId);
    const employer = employers.get(employerId);
    const org = str(employer?.name) || employerId || "Experience";
    /** @type {Entry} */
    const entry = { employerId: employerId || slugify(org), meta: [], org };
    const seat = str(employer?.title);
    if (seat && seat !== org) entry.seat = tagMetrics(seat, corpus);
    const location = str(employer?.location);
    if (location) entry.meta.push(location);
    const logo = matchMark(marks, { employerId: entry.employerId, org });
    if (logo) entry.logo = logo;
    const claimIds = (group.claimIds || []).filter((id) => typeof id === "string");
    const texts = claimIds.map((id) => bulletsById.get(id) || str(claims.get(id)?.text)).filter(Boolean);
    if (texts.length >= 2) {
      entry.bullets = claimIds
        .filter((id) => bulletsById.get(id) || str(claims.get(id)?.text))
        .map((id) => ({ claimId: id, runs: tagMetrics(bulletsById.get(id) || str(claims.get(id)?.text), corpus) }));
    } else if (texts.length === 1) {
      entry.line = texts[0];
      entry.claimId = claimIds[0];
    }
    featured.push(entry);
  }

  /** @type {Entry[]} */
  const earlier = [];
  for (const id of outline.earlier || []) {
    if (typeof id !== "string") continue;
    const claim = claims.get(id);
    const employerId = str(claim?.employerId);
    const employer = employers.get(employerId);
    const org = str(employer?.name) || "Earlier";
    const text = earlierById.get(id) || str(claim?.text);
    if (!text) continue;
    /** @type {Entry} */
    const entry = {
      employerId: employerId || slugify(org),
      meta: [],
      org,
      line: text,
      claimId: id,
    };
    const logo = matchMark(marks, { employerId: entry.employerId, org });
    if (logo) entry.logo = logo;
    earlier.push(entry);
  }

  /** @type {Section[]} */
  const sections = [];
  const readouts = pickReadouts(featured, MATERIALS_BUDGETS.resume.featuredEmployersMax * 2);
  if (readouts.length >= 3) sections.push({ kind: "readouts", label: "Verified figures", readouts });
  if (featured.length) sections.push({ kind: "experience", label: "Experience", entries: featured });
  if (earlier.length) sections.push({ kind: "earlier", label: "Earlier", entries: earlier });
  const tools = (outline.toolsLine || []).filter((t) => typeof t === "string" && t);
  if (tools.length) {
    sections.push({ kind: "tokens", label: "Skills", tokens: tools.slice(0, MATERIALS_BUDGETS.resume.tokens[1]) });
  }
  if (!sections.some((s) => s.kind === "experience" || s.kind === "earlier" || s.kind === "tokens" || s.kind === "credentials")) {
    sections.push({ kind: "experience", label: "Experience", entries: [] });
  }

  const statementRuns = str(draft.statement)
    ? tagMetrics(str(draft.statement), corpus)
    : [{ t: target }];

  const letter = isRecord(draft.letter) ? draft.letter : {};
  const coverLetter = letterDoc(
    {
      hook: str(letter.thesis),
      whyThem: str(letter.analyticsProof),
      whyMe: str(letter.aiOpsProof),
      whyNow: str(letter.nextStep),
      company: str(request.company),
      role: str(request.title),
    },
    request,
    readouts,
    nowIso || new Date().toISOString(),
  );
  coverLetter.templateId = ids.coverLetter;

  return {
    contract: "materials.render-model.v1",
    note: "Built from the claim-ledger pipeline (draft + outline + selection + ledger); claim ids are the ledger's own and metric runs trace to ledger claim text.",
    template: { family: family.id, version: family.version, pageBudget: MATERIALS_BUDGETS.resume.pages },
    provenance: { source: "claim-ledger-pipeline" },
    identity: { name, target, contact: contactFrom([], source) },
    documents: {
      resume: { templateId: ids.resume, statement: { runs: statementRuns }, sections },
      coverLetter,
    },
    atsText: { wrap: 78, bulletMarker: "- ", headings: "upper" },
  };
}

/**
 * @param {AdapterInput} input
 * @returns {RenderModel}
 */
export function buildRenderModelFromWriter({ writerJson, resumeText, request = {}, family, marks = [], nowIso }) {
  const json = isRecord(writerJson) ? writerJson : {};
  const resume = isRecord(json.resume) ? json.resume : {};
  const letter = isRecord(json.letter) ? json.letter : {};
  const header = isRecord(resume.header) ? resume.header : {};
  const source = String(resumeText || "");
  const name = str(header.name) || candidateNameFromText(source) || "Candidate";
  const target = str(header.headline) || str(request.title) || "Candidate";
  const ids = templateIdsFor(family);

  const { sections } = resumeSections(resume, source, marks);
  const summary = isRecord(resume.summary) ? resume.summary : {};
  const opener = str(summary.opener);
  const bodyText = str(summary.body);
  /** @type {Run[]} */
  const statementRuns = [];
  if (opener) statementRuns.push({ hl: opener });
  if (bodyText) {
    const tagged = tagMetrics(bodyText, source);
    if (opener && tagged[0] && typeof tagged[0].t === "string") tagged[0] = { t: ` ${tagged[0].t}` };
    else if (opener) statementRuns.push({ t: " " });
    statementRuns.push(...tagged);
  }
  if (!statementRuns.length) statementRuns.push({ t: target });

  const readouts = sections.find((s) => s.kind === "readouts")?.readouts || [];
  const coverLetter = letterDoc(letter, request, readouts, nowIso || new Date().toISOString());
  coverLetter.templateId = ids.coverLetter;

  if (!sections.some((s) => s.kind === "experience" || s.kind === "earlier" || s.kind === "tokens" || s.kind === "credentials")) {
    sections.push({ kind: "experience", label: "Experience", entries: [] });
  }

  return {
    contract: "materials.render-model.v1",
    note: "Adapted from the v2 writer JSON by server/materials-render-model-adapter.mjs until the claim-ledger pipeline lands; claim ids are synthetic and metric runs are traced to the user's resume text.",
    template: { family: family.id, version: family.version, pageBudget: MATERIALS_BUDGETS.resume.pages },
    provenance: { source: "writer-adapter" },
    identity: { name, target, contact: contactFrom(strList(header.contact), source) },
    documents: {
      resume: { templateId: ids.resume, statement: { runs: statementRuns }, sections },
      coverLetter,
    },
    atsText: { wrap: 78, bulletMarker: "- ", headings: "upper" },
  };
}
