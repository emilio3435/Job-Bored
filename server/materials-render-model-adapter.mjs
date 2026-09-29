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
import { isReadoutMetric, maskNonMetrics, productNumeralSpans } from "./materials-numerals.mjs";
import { companyKey } from "./materials-monogram.mjs";
import { candidateNameFromText, desplitMetricTokens, detectGarbledResume, stripNickname } from "./materials-resume-source.mjs";
import { templateIdsFor } from "./materials-templates.mjs";
import { headlineFor } from "./materials-positioning.mjs";

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
 * @property {unknown} [profile] the saved profile's `identity`; its confirmed name and contact win
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
 * @returns {{ kind: "location" | "phone" | "email" | "site" | "linkedin" | "github" | "other", text: string, href?: string }}
 */
export function classifyContact(text) {
  const t = text.trim();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t)) return { kind: "email", text: t, href: `mailto:${t}` };
  if (/linkedin\.com\//i.test(t)) {
    return { kind: "linkedin", text: t.replace(/^https?:\/\/(www\.)?/i, ""), href: /^https?:/i.test(t) ? t : `https://${t}` };
  }
  if (/^\+?[\d().\s-]{7,}$/.test(t) && (t.match(/\d/g) || []).length >= 7) return { kind: "phone", text: t };
  if (/github\.com\//i.test(t)) {
    return { kind: "github", text: t.replace(/^https?:\/\/(www\.)?/i, ""), href: /^https?:/i.test(t) ? t : `https://${t}` };
  }
  if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(t)) {
    return { kind: "site", text: t.replace(/^https?:\/\/(www\.)?/i, ""), href: /^https?:/i.test(t) ? t : `https://${t}` };
  }
  if (/,/.test(t) || /\b[A-Z]{2}\b/.test(t)) return { kind: "location", text: t };
  return { kind: "other", text: t };
}

/**
 * The resume's own contact line ("Austin, CO 80237 • 512-555-0148 •
 * meridian.example.org • linkedin.com/in/…"), item by item, in its order. Template
 * placeholders ("[your email]") are skipped.
 * @param {string} resumeText
 */
function contactLineFrom(resumeText) {
  const line = resumeText
    .split("\n")
    .slice(0, 8)
    .find((l) => /[•·|]/.test(l) && (/@|linkedin\.com/i.test(l) || /\d{3}\D{0,2}\d{3}\D?\d{4}/.test(l)));
  if (!line) return [];
  return line
    .split(/\s*[•·|]\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !/[[\]{}<>]/.test(part) && part.length <= 80)
    .map(classifyContact)
    .filter((c) => c.kind !== "other");
}

/**
 * Contact lines from the writer's header, else from the resume text itself.
 * @param {string[]} headerContact
 * @param {string} resumeText
 */
export function contactFrom(headerContact, resumeText) {
  const items = headerContact.length ? headerContact.map(classifyContact) : contactLineFrom(resumeText);
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

/**
 * @typedef {{ kind: "location" | "phone" | "email" | "site" | "linkedin" | "github" | "other", text: string, href?: string }} ContactItem
 */

/** @param {string} href */
function bareUrl(href) {
  return href.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
}

/**
 * The contact items a confirmed profile gives, each with an explicit href so
 * every template family (not only Signal) renders it as a link.
 * @param {Record<string, unknown>} profile the profile's `identity`
 * @returns {ContactItem[]}
 */
export function profileContactItems(profile) {
  /** @type {ContactItem[]} */
  const items = [];
  const loc = isRecord(profile.location) ? profile.location : {};
  const place = [str(loc.city), str(loc.state)].filter(Boolean).join(", ");
  if (place) items.push({ kind: "location", text: place });
  const phone = str(profile.phone);
  if (phone) {
    const dial = phone.replace(/[^\d+]/g, "");
    items.push(dial.replace(/\D/g, "").length >= 7 ? { kind: "phone", text: phone, href: `tel:${dial}` } : { kind: "phone", text: phone });
  }
  const email = str(profile.email);
  if (email) items.push({ kind: "email", text: email, href: `mailto:${email}` });
  const links = isRecord(profile.links) ? profile.links : {};
  /** @param {unknown} url */
  const web = (url) => {
    const href = str(url);
    return /^https?:\/\//i.test(href) ? href : "";
  };
  const linkedin = web(links.linkedin);
  if (linkedin) items.push({ kind: "linkedin", text: bareUrl(linkedin), href: linkedin });
  const website = web(links.website);
  if (website) items.push({ kind: "site", text: bareUrl(website), href: website });
  const github = web(links.github);
  if (github) items.push({ kind: "github", text: bareUrl(github), href: github });
  for (const other of Array.isArray(links.other) ? links.other.filter(isRecord) : []) {
    const href = web(other.url);
    if (href) items.push({ kind: "other", text: str(other.label) || bareUrl(href), href });
  }
  return items;
}

/**
 * Name, headline and contact block for a render model. The profile's
 * confirmed details ("Your details") win field by field; the writer's
 * header and the resume text only fill what the profile leaves empty —
 * the Seabright draft rendered "Candidate" because a garbled resume was
 * the only source there was.
 *
 * @param {object} input
 * @param {unknown} [input.profile] the saved profile's `identity`
 * @param {string} input.resumeText
 * @param {string} [input.headerName] the writer's header name
 * @param {string} [input.headerHeadline] the writer's header headline
 * @param {string[]} [input.headerContact] the writer's header contact lines
 * @param {string} [input.fallbackTarget] used when no headline exists anywhere
 * @param {boolean} [input.resumeHeadline] read a headline off the resume
 *   text (the draft path); the writer path goes straight to the fallback
 * @param {string} [input.roleHeadline] the per-role positioning headline
 *   (Wave 3). Precedence (materials-positioning headlineFor): a headline
 *   the user confirmed in "Your details" (identity.headlineConfirmed),
 *   then this per-role headline, then an unconfirmed profile headline
 *   (pre-filled from the resume), then the writer header, the resume
 *   line and the fallback.
 * @returns {{ name: string, target: string, contact: ContactItem[], targetSource: string }}
 */
export function renderIdentity({ profile, resumeText, headerName = "", headerHeadline = "", headerContact = [], fallbackTarget = "", resumeHeadline = true, roleHeadline = "" }) {
  const identity = isRecord(profile) ? profile : {};
  const source = String(resumeText || "");
  const name =
    stripNickname(str(identity.fullName)) ||
    stripNickname(str(headerName)) ||
    candidateNameFromText(source) ||
    "Candidate";
  const chosen = headlineFor(identity, roleHeadline);
  const target =
    chosen.headline ||
    str(headerHeadline) ||
    (resumeHeadline ? headlineFromResume(source) : "") ||
    str(fallbackTarget) ||
    "Candidate";
  const confirmed = profileContactItems(identity);
  const have = new Set(confirmed.map((c) => c.kind));
  /* Resume-parsed items fill only the kinds the profile left empty. */
  const parsed = contactFrom(headerContact, source).filter((c) => !have.has(c.kind));
  const order = ["location", "phone", "email", "linkedin", "site", "github", "other"];
  const contact = [...confirmed, ...parsed].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return { name, target, contact, targetSource: chosen.source || "" };
}

/**
 * A stored render model's identity with the profile's confirmed details laid
 * over it (regenerate): name and headline replace, contact kinds the
 * profile gives replace the stored ones of the same kind.
 *
 * @param {{ name: string, target: string, targetSource?: string, contact: Array<{ kind: string, text: string, href?: string }> }} stored
 * @param {unknown} profile the saved profile's `identity`
 */
export function overlayProfileIdentity(stored, profile) {
  if (!isRecord(profile)) return stored;
  const confirmedItems = profileContactItems(profile);
  /** @type {Set<string>} */
  const have = new Set(confirmedItems.map((c) => c.kind));
  const order = ["location", "phone", "email", "linkedin", "site", "github", "other"];
  /** @type {Array<{ kind: string, text: string, href?: string }>} */
  const contact = [...confirmedItems, ...(stored.contact || []).filter((c) => !have.has(c.kind))].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  );
  /* Wave 3 headline precedence: a confirmed "Your details" headline
   * always wins; a stored per-role headline survives an unconfirmed
   * (resume pre-filled) profile headline. */
  const confirmed = profile.headlineConfirmed === true && str(profile.headline);
  const keepRole = stored.targetSource === "role" && !confirmed;
  return {
    name: stripNickname(str(profile.fullName)) || stored.name,
    target: keepRole ? stored.target : str(profile.headline) || stored.target,
    contact: contact.length ? contact : stored.contact,
    ...(keepRole ? { targetSource: "role" } : {}),
  };
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
  for (const match of maskNonMetrics(text).matchAll(METRIC_RE)) {
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
 * @param {{ employerId?: string, org: string }} target
 * @returns {import("./materials-render.mjs").Logo | undefined}
 */
export function matchMark(marks, { org }) {
  /* Logo identity is the company's exact normalized name. IDs and prefixes
     can point at a different employer/client and must not borrow its mark. */
  const orgKey = companyKey(org);
  const mark = marks.find((m) => orgKey && (companyKey(m.label) === orgKey || m.slug === orgKey));
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
 * The words after the `n` run at `index`, as printed.
 * @param {Run[]} runs
 * @param {number} index
 */
function followingText(runs, index) {
  return runs.slice(index + 1).map((r) => r.t ?? r.hl ?? r.n ?? "").join("").slice(0, 80);
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
        /* A readout is a real metric (money, %, multiplier, rank, a count
         * of people or accounts), never a bare numeral. */
        if (!isReadoutMetric(run.n, followingText(bullet.runs, index))) return;
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
 * @param {{ company?: unknown, title?: unknown }} request
 * @param {Readout[]} resumeReadouts
 * @param {string} nowIso
 * @param {Array<{ text: string, href: string }>} [links]
 */
function letterDoc(letter, request, resumeReadouts, nowIso, links = []) {
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

  const body = paragraphs.map((text, index) => {
    const own = links.filter((l) => l && l.text && /^https?:\/\//i.test(l.href) && text.includes(l.text));
    return {
      id: `p${index + 1}`,
      beat: beats[Math.min(index, beats.length - 1)],
      text,
      ...(own.length ? { links: own.map((l) => ({ text: l.text, href: l.href })) } : {}),
    };
  });
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
  /* The pull quote comes from the proof: the third of four paragraphs,
   * the second of three. */
  const third = body.length === 3 ? body[1] : body[2];
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
 * Headline, role dates, education (Wave 1 L4: P-4, P-5)
 * ------------------------------------------------------------------ */

const DATE_RANGE_RE = /((?:[A-Z][a-z]{2,8}\.?\s+)?(?:19|20)\d\d)\s*[–—-]\s*((?:[A-Z][a-z]{2,8}\.?\s+)?(?:19|20)\d\d|Present|Current|Now)\b/;
const HEADING_RE = /^[A-Z][A-Z0-9 &/,'’-]{3,}$/;

/**
 * P-5: the candidate's own headline — the line under the name on their
 * resume ("Digital Sales Leader • AI Product Builder"). Never the posting
 * title. Empty when the resume has none.
 * @param {string} text
 */
export function headlineFromResume(text) {
  if (!candidateNameFromText(text)) return "";
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const next = lines[1] || "";
  if (!next || next.length > 90 || HEADING_RE.test(next)) return "";
  if (/[@\d]|linkedin|https?:|www\./i.test(next)) return "";
  return str(next);
}

/**
 * P-4: a role's date range — the ledger's start/end, else the resume line
 * that names the employer (and, when known, the seat) with a date range.
 * @param {Record<string, unknown> | undefined} employer
 * @param {string} org
 * @param {string[]} resumeLines
 */
function roleDates(employer, org, resumeLines) {
  const start = str(employer?.start);
  if (start) return `${start} – ${str(employer?.end) || "Present"}`;
  const name = org.toLowerCase();
  if (!name) return "";
  const seat = str(employer?.title).toLowerCase();
  const lines = resumeLines.filter((line) => line.toLowerCase().includes(name) && DATE_RANGE_RE.test(line));
  const best = (seat && lines.find((line) => line.toLowerCase().includes(seat))) || lines[0];
  const match = best ? DATE_RANGE_RE.exec(best) : null;
  return match ? `${match[1]} – ${match[2]}` : "";
}

/**
 * P-4: education lines — the ledger's education claims, else the lines
 * under the resume's EDUCATION heading.
 * @param {{ claims?: Array<{ kind?: unknown, text?: unknown }> }} ledger
 * @param {string[]} resumeLines
 * @returns {string[]}
 */
function educationLines(ledger, resumeLines) {
  const fromLedger = (ledger.claims || [])
    .filter((c) => isRecord(c) && c.kind === "education")
    .map((c) => str(c.text))
    .filter(Boolean);
  if (fromLedger.length) return fromLedger.slice(0, 3);
  const at = resumeLines.findIndex((line) => /^education\b/i.test(line) && line.length <= 40);
  if (at === -1) return [];
  /** @type {string[]} */
  const out = [];
  for (const line of resumeLines.slice(at + 1)) {
    if (!line) continue;
    if (HEADING_RE.test(line)) break;
    out.push(str(line));
    if (out.length >= 3) break;
  }
  return out;
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
 * @param {Record<string, unknown>} input.draft materials.draft.v2 (v1 still accepted)
 * @param {{ featured?: Array<{ employerId?: unknown, claimIds?: unknown[], roles?: unknown[] }>, earlier?: unknown[], toolsLine?: unknown[] }} input.outline
 * @param {{ employers?: Array<{ id?: unknown, name?: unknown, title?: unknown, location?: unknown, start?: unknown, end?: unknown }>, claims?: Array<{ id?: unknown, employerId?: unknown, kind?: unknown, text?: unknown }> }} input.ledger
 * @param {string} [input.resumeText] the user's own resume, for identity + contact gaps
 * @param {unknown} [input.profile] the saved profile's `identity`; its confirmed name and contact win
 * @param {{ company?: unknown, title?: unknown }} [input.request]
 * @param {import("./materials-templates.mjs").TemplateFamily} input.family
 * @param {ResolvedMark[]} [input.marks]
 * @param {string} [input.nowIso]
 * @param {Array<{ text: string, href: string }>} [input.links] project name → URL (voice.md hyperlink convention)
 * @param {string} [input.roleHeadline] the per-role positioning headline (see renderIdentity)
 * @returns {RenderModel}
 */
export function buildRenderModelFromDraft({ draft, outline, ledger, resumeText = "", profile, request = {}, family, marks = [], nowIso, links = [], roleHeadline = "" }) {
  const source = String(resumeText || "");
  const claims = new Map(
    (ledger.claims || []).filter(isRecord).map((c) => [c.id, c]),
  );
  const employers = new Map(
    (ledger.employers || []).filter(isRecord).map((e) => [e.id, e]),
  );
  /* Metric membership corpus: the ledger's own claim texts. */
  const corpus = [...claims.values()].map((c) => str(c.text)).join("\n");
  const resumeLines = source.split("\n").map((line) => line.trim());
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
    const roleRows = Array.isArray(group.roles) ? group.roles.filter(isRecord) : [];
    const seat = str(employer?.title);
    if (seat && seat !== org && roleRows.length < 2) entry.seat = tagMetrics(seat, corpus);
    const dates = roleDates(employer, org, resumeLines);
    if (dates) entry.meta.push(dates);
    const location = str(employer?.location);
    if (location) entry.meta.push(location);
    const logo = matchMark(marks, { employerId: entry.employerId, org });
    if (logo) entry.logo = logo;
    const claimIds = (group.claimIds || []).filter((id) => typeof id === "string");
    const texts = claimIds.map((id) => bulletsById.get(id) || str(claims.get(id)?.text)).filter(Boolean);
    if (roleRows.length >= 2) {
      /* P-4: each role at the company is its own dated sub-row; bullets
       * stay on the entry (fit trims them there) and roles name theirs. */
      entry.roles = roleRows.map((role) => ({
        seat: tagMetrics(str(role.title), corpus),
        meta: [[str(role.start), str(role.end) || (str(role.start) ? "Present" : "")].filter(Boolean).join(" – ")].filter(Boolean),
        claimIds: (Array.isArray(role.claimIds) ? role.claimIds : []).filter((id) => typeof id === "string"),
      }));
      entry.bullets = claimIds
        .filter((id) => bulletsById.get(id) || str(claims.get(id)?.text))
        .map((id) => ({ claimId: id, runs: tagMetrics(bulletsById.get(id) || str(claims.get(id)?.text), corpus) }));
    } else if (texts.length >= 2) {
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
      meta: employer ? [roleDates(employer, org, resumeLines)].filter(Boolean) : [],
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
  const tools = (outline.toolsLine || []).flatMap((t) => (typeof t === "string" && t ? [t] : []));
  if (tools.length) {
    sections.push({ kind: "tokens", label: "Skills", tokens: tools.slice(0, MATERIALS_BUDGETS.resume.tokens[1]) });
  }
  const education = educationLines(ledger, resumeLines);
  if (education.length) {
    sections.push({ kind: "credentials", label: "Education", lines: education.map((line) => ({ runs: [{ t: line }] })) });
  }
  if (!sections.some((s) => s.kind === "experience" || s.kind === "earlier" || s.kind === "tokens" || s.kind === "credentials")) {
    sections.push({ kind: "experience", label: "Experience", entries: [] });
  }

  /* P-5: the headline under the name is the candidate's own, never the
   * posting title; the most recent seat stands in when the resume has none. */
  const seatFallback = featured.map((e) => str(employers.get(e.employerId)?.title)).find((t) => t && !/[@\d|]/.test(t));
  const who = renderIdentity({ profile, resumeText: source, fallbackTarget: seatFallback, roleHeadline });
  const target = who.target;
  const statementRuns = str(draft.statement)
    ? tagMetrics(str(draft.statement), corpus)
    : [{ t: target }];

  const letter = isRecord(draft.letter) ? draft.letter : {};
  /* draft v2 beats (hook + companyInsight open the letter as one
   * paragraph); v1 drafts keep their four slots. */
  const v2 = "hook" in letter || "proof1" in letter;
  /* Voice v5: a v2 letter renders as three paragraphs (hook, evidence,
   * close); v1 drafts keep their four. */
  const coverLetter = letterDoc(
    {
      hook: v2 ? [str(letter.hook), str(letter.companyInsight)].filter(Boolean).join(" ") : str(letter.thesis),
      whyThem: v2 ? [str(letter.proof1), str(letter.proof2)].filter(Boolean).join(" ") : str(letter.analyticsProof),
      whyMe: v2 ? "" : str(letter.aiOpsProof),
      whyNow: str(v2 ? letter.ask : letter.nextStep),
      company: str(request.company),
      role: str(request.title),
    },
    request,
    readouts,
    nowIso || new Date().toISOString(),
    links,
  );
  coverLetter.templateId = ids.coverLetter;

  return {
    contract: "materials.render-model.v1",
    note: "Built from the claim-ledger pipeline (draft + outline + selection + ledger); claim ids are the ledger's own and metric runs trace to ledger claim text.",
    template: { family: family.id, version: family.version, pageBudget: MATERIALS_BUDGETS.resume.pages },
    provenance: { source: "claim-ledger-pipeline" },
    identity: { name: who.name, target, contact: who.contact, ...(who.targetSource === "role" ? { targetSource: "role" } : {}) },
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
export function buildRenderModelFromWriter({ writerJson, resumeText, profile, request = {}, family, marks = [], nowIso }) {
  const json = isRecord(writerJson) ? writerJson : {};
  const resume = isRecord(json.resume) ? json.resume : {};
  const letter = isRecord(json.letter) ? json.letter : {};
  const header = isRecord(resume.header) ? resume.header : {};
  const source = String(resumeText || "");
  const who = renderIdentity({
    profile,
    resumeText: source,
    headerName: str(header.name),
    headerHeadline: str(header.headline),
    headerContact: strList(header.contact),
    fallbackTarget: str(request.title),
    resumeHeadline: false,
  });
  const target = who.target;
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
    note: "Adapted from v2 writer JSON for the sample/visual harness; production drafts flow through the claim-ledger pipeline (buildRenderModelFromDraft) with real claim ids.",
    template: { family: family.id, version: family.version, pageBudget: MATERIALS_BUDGETS.resume.pages },
    provenance: { source: "writer-adapter" },
    identity: { name: who.name, target, contact: who.contact },
    documents: {
      resume: { templateId: ids.resume, statement: { runs: statementRuns }, sections },
      coverLetter,
    },
    atsText: { wrap: 78, bulletMarker: "- ", headings: "upper" },
  };
}

/* ------------------------------------------------------------------ *
 * Stored models (regenerate)
 * ------------------------------------------------------------------ */

/**
 * Re-join figures a PDF text layer split ("$ 10 M +") in a run list; the
 * de-split text is re-tagged against itself, since its figures were traced
 * when the draft was made.
 * @param {Run[] | undefined} runs
 * @returns {Run[] | undefined}
 */
function desplitRuns(runs) {
  if (!Array.isArray(runs)) return runs;
  const text = runs.map((r) => r.t ?? r.hl ?? r.n ?? "").join("");
  const fixed = desplitMetricTokens(text);
  /* A figure emphasised inside a product name ("Chirp 3 HD") is re-tagged too. */
  let at = 0;
  const productFigure = runs.some((r) => {
    const start = at;
    at += (r.t ?? r.hl ?? r.n ?? "").length;
    const n = r.n;
    return typeof n === "string" && productNumeralSpans(text).some(([a, b]) => a < start + n.length && b > start);
  });
  return fixed === text && !productFigure ? runs : tagMetrics(fixed, fixed);
}

/**
 * Bring a stored render model up to the current resume and rules without a
 * model call: identity (name, headline, contact) from the user's current
 * resume, split figures re-joined, and readouts re-picked so the ticker
 * shows only real metrics. Garbled resume text is never used for identity.
 *
 * @param {RenderModel} stored
 * @param {string} resumeText the resume the package speaks for ("" = keep identity)
 * @returns {RenderModel}
 */
export function refreshStoredModel(stored, resumeText) {
  /** @type {RenderModel} */
  const model = JSON.parse(JSON.stringify(stored));
  const source = String(resumeText || "");
  if (source && !detectGarbledResume(source).garbled) {
    const name = candidateNameFromText(source);
    if (name) model.identity.name = name;
    const headline = headlineFromResume(source);
    /* The pipeline always sets the resume's own headline when it has one;
     * a stored pipeline model without it was drafted from bad text. */
    const pipeline = model.provenance?.source === "claim-ledger-pipeline";
    /* Wave 3: a per-role headline is not the resume's to replace. */
    const roleTarget = /** @type {{ targetSource?: unknown }} */ (model.identity).targetSource === "role";
    if (headline && !roleTarget && (pipeline || !model.identity.target || model.identity.target === "Candidate")) model.identity.target = headline;
    const fromResume = contactFrom([], source);
    if (fromResume.length) {
      /** @type {Set<string>} */
      const kinds = new Set(fromResume.map((c) => c.kind));
      model.identity.contact = [...fromResume, ...(model.identity.contact || []).filter((c) => !kinds.has(String(c.kind)))];
    }
  }
  const resume = model.documents.resume;
  if (resume) {
    if (resume.statement) resume.statement.runs = /** @type {Run[]} */ (desplitRuns(resume.statement.runs));
    /** @type {Entry[]} */
    const featured = [];
    for (const section of resume.sections || []) {
      if (section.kind !== "experience" && section.kind !== "earlier") continue;
      for (const entry of section.entries || []) {
        if (Array.isArray(entry.seat)) entry.seat = desplitRuns(entry.seat);
        else if (typeof entry.seat === "string") entry.seat = desplitMetricTokens(entry.seat);
        if (typeof entry.line === "string") entry.line = desplitMetricTokens(entry.line);
        for (const bullet of entry.bullets || []) bullet.runs = /** @type {Run[]} */ (desplitRuns(bullet.runs));
        if (section.kind === "experience") featured.push(entry);
      }
    }
    const at = (resume.sections || []).findIndex((s) => s.kind === "readouts");
    if (at !== -1) {
      const previous = resume.sections[at].readouts || [];
      const readouts = pickReadouts(featured, Math.max(previous.length, MATERIALS_BUDGETS.resume.featuredEmployersMax * 2));
      if (readouts.length >= 3) resume.sections[at] = { ...resume.sections[at], readouts };
      else resume.sections.splice(at, 1);
    }
  }
  const letter = model.documents.coverLetter;
  if (letter) {
    for (const p of letter.paragraphs || []) p.text = desplitMetricTokens(p.text);
    if (letter.pullQuote) letter.pullQuote.text = desplitMetricTokens(letter.pullQuote.text);
    if (letter.readouts) {
      const kept = letter.readouts
        .map((r) => ({ ...r, n: desplitMetricTokens(r.n), caption: desplitMetricTokens(r.caption) }))
        .filter((r) => isReadoutMetric(r.n, r.caption));
      if (kept.length >= 2) letter.readouts = kept;
      else delete letter.readouts;
    }
  }
  return model;
}
