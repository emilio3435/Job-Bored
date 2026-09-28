/**
 * profile-identity.mjs — the user's confirmed contact identity ("Your
 * details") on the fit profile: `identity.fullName`, `headline`, `email`,
 * `phone`, `location {city, state}` and `links {linkedin, website, github,
 * other[≤3]}`. Every field is optional (user-profile.schema.json).
 *
 * Three jobs live here:
 *
 *   1. Suggest. `suggestIdentityFromResume(text)` reads a resume's header
 *      and proposes each field with a confidence. It is pure and never
 *      saves: the wizard step and Settings show the suggestion, the user
 *      edits and confirms.
 *   2. Normalise and migrate. `normalizeContact` turns what a form (or a
 *      hand-edited profile.json) holds into the schema's shape — trimmed,
 *      empty fields dropped, a scheme on bare links, "Austin, TX" split into
 *      city and state, nicknames out of fullName. `migrateProfile` applies
 *      it to a whole profile so an older or hand-edited file still loads.
 *   3. Merge. `withContact` replaces the contact half of `identity`;
 *      `carryForwardContact` keeps it across a POST /profile from an editor
 *      that predates these fields, so saving the fit profile never wipes the
 *      user's name.
 */

import { classifyContact, contactFrom, headlineFromResume } from "./materials-render-model-adapter.mjs";
import { candidateNameFromText, stripNickname } from "./materials-resume-source.mjs";

/** Identity keys that are contact details rather than search intent. */
export const CONTACT_KEYS = Object.freeze(["fullName", "headline", "headlineConfirmed", "email", "phone", "location", "links"]);

const LINK_KEYS = Object.freeze(["linkedin", "website", "github"]);
export const MAX_OTHER_LINKS = 3;

const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?[0-9(][0-9 ().-]{5,29}[0-9]$/;
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
/* "Austin, TX", "Austin, Texas", "Brooklyn, NY 11201". */
const CITY_STATE_RE = /^([A-Za-z][A-Za-z .'-]{0,60}?),\s*([A-Za-z][A-Za-z .]{1,40}?)(?:\s+\d{5}(?:-\d{4})?)?$/;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {number} max */
function clean(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

/** @param {string} value */
function digits(value) {
  return (value.match(/\d/g) || []).length;
}

/**
 * A bare "linkedin.com/in/x" or "www.site.dev" gets https://; anything that
 * still is not an http(s) URL is dropped.
 * @param {unknown} value
 */
export function normalizeUrl(value) {
  const text = clean(value, 300).replace(/\s+/g, "");
  if (!text) return "";
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`;
  return URL_RE.test(withScheme) && /\.[a-z]{2,}/i.test(withScheme) ? withScheme : "";
}

/**
 * "Austin, TX" → { city: "Austin", state: "TX" }. Anything without a comma
 * is kept whole as the city.
 * @param {unknown} value
 * @returns {{ city?: string, state?: string } | null}
 */
export function parseLocation(value) {
  if (isRecord(value)) {
    const out = /** @type {{ city?: string, state?: string }} */ ({});
    const city = clean(value.city, 80);
    const state = clean(value.state, 80);
    if (city) out.city = city;
    if (state) out.state = state;
    return out.city || out.state ? out : null;
  }
  const text = clean(value, 160);
  if (!text) return null;
  const match = CITY_STATE_RE.exec(text);
  if (match) return { city: match[1].trim(), state: match[2].trim() };
  const [city, ...rest] = text.split(",").map((part) => part.trim());
  const out = /** @type {{ city?: string, state?: string }} */ ({});
  if (city) out.city = city.slice(0, 80);
  if (rest.length && rest.join(", ")) out.state = rest.join(", ").slice(0, 80);
  return out.city || out.state ? out : null;
}

/**
 * The display name: nickname out, whitespace collapsed. Case is the user's.
 * @param {unknown} value
 */
export function cleanFullName(value) {
  return clean(stripNickname(clean(value, 200)), 120);
}

/**
 * Turn a contact-ish object into the schema's shape. Unknown keys are
 * dropped; empty values are dropped (absent = "not given"); bad formats are
 * kept so validation can name them — except links, which are only kept once
 * they are real http(s) URLs.
 *
 * Accepts, for backcompat with hand-edited files and older drafts:
 *   location as a "City, ST" string; links as an array of {label, url};
 *   `website`/`portfolio`/`linkedin`/`github` given at the top level.
 *
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeContact(raw) {
  const src = isRecord(raw) ? raw : {};
  /** @type {Record<string, unknown>} */
  const out = {};
  const fullName = cleanFullName(src.fullName);
  if (fullName) out.fullName = fullName;
  const headline = clean(src.headline, 160);
  if (headline) out.headline = headline;
  /* Wave 3: a headline the user typed or confirmed wins over the per-role
   * positioning headline; without a headline the flag means nothing. */
  if (headline && src.headlineConfirmed === true) out.headlineConfirmed = true;
  const email = clean(src.email, 254).replace(/^mailto:/i, "");
  if (email) out.email = email;
  const phone = clean(src.phone, 32).replace(/^tel:/i, "");
  if (phone) out.phone = phone;
  const location = parseLocation(src.location);
  if (location) out.location = location;

  /** @type {Record<string, unknown>} */
  const links = {};
  /** @type {Array<{ label: string, url: string }>} */
  const other = [];
  const rawLinks = src.links;
  /** @param {string} label @param {unknown} url */
  const place = (label, url) => {
    const href = normalizeUrl(url);
    if (!href) return;
    const kind = linkKind(href);
    const named = label.trim().toLowerCase();
    if (kind !== "website" && !links[kind]) {
      links[kind] = href;
      return;
    }
    if (kind === "website" && !links.website && ["", "website", "site", "portfolio", "web"].includes(named)) {
      links.website = href;
      return;
    }
    if (other.length < MAX_OTHER_LINKS && !other.some((o) => o.url === href)) {
      other.push({ label: clean(label, 40) || hostLabel(href), url: href });
    }
  };
  if (isRecord(rawLinks)) {
    for (const key of LINK_KEYS) {
      const href = normalizeUrl(rawLinks[key]);
      if (href) links[key] = href;
    }
    if (!links.website) {
      const portfolio = normalizeUrl(rawLinks.portfolio);
      if (portfolio) links.website = portfolio;
    }
    if (Array.isArray(rawLinks.other)) {
      for (const item of rawLinks.other) {
        if (!isRecord(item)) continue;
        const href = normalizeUrl(item.url);
        if (!href || other.length >= MAX_OTHER_LINKS || other.some((o) => o.url === href)) continue;
        other.push({ label: clean(item.label, 40) || hostLabel(href), url: href });
      }
    }
  } else if (Array.isArray(rawLinks)) {
    for (const item of rawLinks) {
      if (typeof item === "string") place("", item);
      else if (isRecord(item)) place(clean(item.label, 40), item.url);
    }
  }
  for (const key of LINK_KEYS) {
    if (!links[key]) {
      const href = normalizeUrl(src[key]);
      if (href) links[key] = href;
    }
  }
  if (!links.website) {
    const portfolio = normalizeUrl(src.portfolio);
    if (portfolio) links.website = portfolio;
  }
  if (other.length) links.other = other;
  if (Object.keys(links).length) out.links = links;
  return out;
}

/** @param {string} href */
function linkKind(href) {
  if (/linkedin\.com\//i.test(href)) return "linkedin";
  if (/github\.com\//i.test(href)) return "github";
  return "website";
}

/** @param {string} href */
export function hostLabel(href) {
  try {
    return new URL(href).hostname.replace(/^www\./i, "").slice(0, 40) || "Link";
  } catch {
    return "Link";
  }
}

/**
 * The checks JSON schema cannot express (the pattern allows "(-----1").
 * Field paths match fit-profile-schema.js's validateContact.
 * @param {Record<string, unknown>} contact normalized contact
 * @returns {Array<{ field: string, message: string }>}
 */
export function contactFormatErrors(contact) {
  /** @type {Array<{ field: string, message: string }>} */
  const errors = [];
  if (typeof contact.email === "string" && !EMAIL_RE.test(contact.email)) {
    errors.push({ field: "identity.email", message: "That email doesn't look right — check for a typo." });
  }
  if (typeof contact.phone === "string" && (!PHONE_RE.test(contact.phone) || digits(contact.phone) < 7)) {
    errors.push({ field: "identity.phone", message: "Use digits, spaces, dashes or parentheses — at least 7 digits." });
  }
  return errors;
}

/**
 * Return `identity` minus every contact key.
 * @param {unknown} identity
 */
export function withoutContact(identity) {
  const src = isRecord(identity) ? identity : {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    if (!CONTACT_KEYS.includes(key)) out[key] = value;
  }
  return out;
}

/**
 * Only the contact keys of `identity`.
 * @param {unknown} identity
 */
export function contactOf(identity) {
  const src = isRecord(identity) ? identity : {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of CONTACT_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  return out;
}

/**
 * The profile with its contact half replaced by `contact` (normalized).
 * Keys `contact` leaves out are cleared: this is how a user removes a field.
 * @param {Record<string, unknown>} profile
 * @param {unknown} contact
 */
export function withContact(profile, contact) {
  const identity = { ...withoutContact(profile.identity), ...normalizeContact(contact) };
  return { ...profile, identity };
}

/**
 * POST /profile backcompat: an editor that predates the contact fields
 * sends `identity` without them. Keep each contact key the candidate does
 * not mention from the saved profile, so saving the fit profile never
 * erases the user's name. A key the candidate DOES send wins.
 * @param {Record<string, unknown>} candidate
 * @param {unknown} prior
 */
export function carryForwardContact(candidate, prior) {
  if (!isRecord(candidate) || !isRecord(candidate.identity)) return candidate;
  const saved = isRecord(prior) ? contactOf(prior.identity) : {};
  const identity = { ...candidate.identity };
  let changed = false;
  for (const key of CONTACT_KEYS) {
    if (!(key in identity) && saved[key] !== undefined) {
      identity[key] = saved[key];
      changed = true;
    }
  }
  return changed ? { ...candidate, identity } : candidate;
}

/**
 * Bring an older or hand-edited profile up to the current identity shape,
 * in memory. A profile with no contact keys comes back unchanged (same
 * object), so the claim ledger's profile hash does not move.
 * @template T
 * @param {T} profile
 * @returns {T}
 */
export function migrateProfile(profile) {
  if (!isRecord(profile) || !isRecord(profile.identity)) return profile;
  const present = CONTACT_KEYS.some((key) => key in /** @type {Record<string, unknown>} */ (profile.identity));
  if (!present) return profile;
  return /** @type {T} */ (/** @type {unknown} */ (withContact(profile, contactOf(profile.identity))));
}

/**
 * The profile as the claim ledger hashes it: contact details are not facts
 * a draft can cite, so changing a phone number must not rebuild the ledger.
 * @template T
 * @param {T} profile
 * @returns {T}
 */
export function profileForLedger(profile) {
  if (!isRecord(profile) || !isRecord(profile.identity)) return profile;
  const present = CONTACT_KEYS.some((key) => key in /** @type {Record<string, unknown>} */ (profile.identity));
  if (!present) return profile;
  return /** @type {T} */ (/** @type {unknown} */ ({ ...profile, identity: withoutContact(profile.identity) }));
}

/* ------------------------------------------------------------------ *
 * Suggestions from a resume
 * ------------------------------------------------------------------ */

/**
 * @typedef {{ value: string, confidence: number }} TextSuggestion
 * @typedef {{
 *   fullName: TextSuggestion | null,
 *   headline: TextSuggestion | null,
 *   email: TextSuggestion | null,
 *   phone: TextSuggestion | null,
 *   location: { value: { city?: string, state?: string }, confidence: number } | null,
 *   links: {
 *     linkedin: TextSuggestion | null,
 *     website: TextSuggestion | null,
 *     github: TextSuggestion | null,
 *     other: Array<{ value: { label: string, url: string }, confidence: number }>,
 *   },
 * }} IdentitySuggestions
 */

/** Separators a resume header puts between contact items. */
const HEADER_SPLIT_RE = /\s*(?:[|•·▪◦∙⋅;]|\s{2,}|\t| – | — )\s*/u;
const HEADER_LINES = 8;

/** @param {string} text */
function titleCaseIfShouting(text) {
  if (!/[A-Z]/.test(text) || text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_m, lead, ch) => `${lead}${ch.toUpperCase()}`);
}

/**
 * The tokens of a resume's header block (first lines, split on the usual
 * separators), each with the line it came from.
 * @param {string} text
 */
function headerTokens(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, HEADER_LINES);
  /** @type {Array<{ token: string, line: number }>} */
  const tokens = [];
  lines.forEach((line, index) => {
    for (const part of line.split(HEADER_SPLIT_RE)) {
      const token = part.replace(/^(e-?mail|phone|tel|mobile|cell|linkedin|web(site)?|portfolio|github)\s*:\s*/i, "").trim();
      if (token) tokens.push({ token, line: index });
    }
  });
  return { lines, tokens };
}

/**
 * Propose the user's details from their resume text. Pure: no I/O, no
 * saving. Each field carries a confidence in [0, 1]; the UI marks anything
 * under 0.7 "check this". Fields with nothing to go on are null.
 *
 * @param {string} resumeText
 * @returns {IdentitySuggestions}
 */
export function suggestIdentityFromResume(resumeText) {
  const text = String(resumeText || "").replace(/\r/g, "");
  /** @type {IdentitySuggestions} */
  const out = {
    fullName: null,
    headline: null,
    email: null,
    phone: null,
    location: null,
    links: { linkedin: null, website: null, github: null, other: [] },
  };
  if (!text.trim()) return out;
  const { lines, tokens } = headerTokens(text);

  /* Name: the resume's first line, nickname stripped (stripNickname inside
   * candidateNameFromText). A shouted name is offered in title case. */
  const rawName = candidateNameFromText(text);
  if (rawName) {
    const words = rawName.split(/\s+/);
    const plausible = words.length >= 2 && words.length <= 4 && /^[\p{L}][\p{L} .'’-]*$/u.test(rawName);
    const shouting = rawName === rawName.toUpperCase();
    out.fullName = {
      value: cleanFullName(titleCaseIfShouting(rawName)),
      confidence: plausible ? (shouting ? 0.8 : 0.9) : 0.5,
    };
  }

  /* Contact items the header names, classified the way the renderer does. */
  const classified = tokens.map(({ token, line }) => ({ ...classifyContact(token), line }));
  const fallback = contactFrom([], text);

  const email = classified.find((c) => c.kind === "email") || fallback.find((c) => c.kind === "email");
  if (email) out.email = { value: email.text, confidence: 0.95 };

  const phone = classified.find((c) => c.kind === "phone") || fallback.find((c) => c.kind === "phone");
  if (phone && digits(phone.text) >= 7) {
    out.phone = { value: phone.text.replace(/\s+/g, " ").trim(), confidence: 0.9 };
  }

  const linkedin = classified.find((c) => c.kind === "linkedin") || fallback.find((c) => c.kind === "linkedin");
  if (linkedin) {
    const href = normalizeUrl(linkedin.href || linkedin.text);
    if (href) out.links.linkedin = { value: href, confidence: 0.9 };
  }

  for (const site of classified.filter((c) => c.kind === "site")) {
    const href = normalizeUrl(site.href || site.text);
    if (!href) continue;
    if (/github\.com\//i.test(href)) {
      if (!out.links.github) out.links.github = { value: href, confidence: 0.85 };
    } else if (!out.links.website) {
      out.links.website = { value: href, confidence: 0.7 };
    } else if (out.links.other.length < MAX_OTHER_LINKS && href !== out.links.website.value) {
      out.links.other.push({ value: { label: hostLabel(href), url: href }, confidence: 0.5 });
    }
  }
  if (!out.links.github) {
    const gh = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i.exec(text);
    if (gh) out.links.github = { value: normalizeUrl(gh[0]), confidence: 0.7 };
  }

  /* Location: a "City, ST" token in the header. */
  const place = classified.find((c) => c.kind === "location" && CITY_STATE_RE.test(c.text));
  if (place) {
    const parsed = parseLocation(place.text);
    if (parsed) out.location = { value: parsed, confidence: 0.8 };
  }

  /* Headline: the line under the name, when it is not a contact line or a
   * place. headlineFromResume already refuses headings, emails, digits and
   * URLs; a bare "Austin, TX" would otherwise read as a headline. */
  const headline = headlineFromResume(text);
  if (headline && !CITY_STATE_RE.test(headline) && headline.split(HEADER_SPLIT_RE).length <= 3) {
    out.headline = { value: headline, confidence: headline.length <= 80 ? 0.75 : 0.5 };
  } else if (!headline && lines.length > 2 && rawName) {
    /* The line after a contact line, e.g. name / contacts / headline. */
    const third = lines[2];
    if (third && third.length <= 90 && !/[@\d]|https?:|www\./i.test(third) && !/^[A-Z][A-Z0-9 &/,'’-]{3,}$/.test(third)) {
      out.headline = { value: clean(third, 160), confidence: 0.5 };
    }
  }
  return out;
}

/**
 * The suggestions flattened to a contact object (what the form pre-fills).
 * @param {IdentitySuggestions} suggestions
 */
export function suggestionValues(suggestions) {
  return normalizeContact({
    fullName: suggestions.fullName?.value,
    headline: suggestions.headline?.value,
    email: suggestions.email?.value,
    phone: suggestions.phone?.value,
    location: suggestions.location?.value,
    links: {
      linkedin: suggestions.links.linkedin?.value,
      website: suggestions.links.website?.value,
      github: suggestions.links.github?.value,
      other: suggestions.links.other.map((o) => o.value),
    },
  });
}
