// @ts-check
/**
 * listing-prefilter.mjs — the one deterministic hard-constraint gate.
 *
 * Discovery (integrations/browser-use-discovery profile-aware-scorer.ts and
 * lead-normalizer.ts) and rescore (server/profile-rescore-worker.mjs) both
 * import this module, so the same job gets the same decision on either path.
 * The two used to be hand-mirrored copies that drifted (HOLES R2, R9, R10);
 * tests/holes-keep-prefilter-parity.test.mjs runs one fixture through all
 * three entry points.
 */

/** @typedef {"remote" | "hybrid" | "onsite" | "unknown"} RemoteBucket */

/** @param {string} input */
function stripHtml(input) {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} input */
function normalizeWhitespace(input) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const REMOTE_LOCATION_PATTERN = /\b(remote|remote-first|distributed|work from home|wfh|anywhere)\b/i;
export const HYBRID_LOCATION_PATTERN = /\bhybrid\b/i;
export const ONSITE_LOCATION_PATTERN = /\b(on[\s-]?site|in[\s-]?office|office-based)\b/i;

/** @param {string} input */
export function normalizeLocationText(input) {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/\bu\.?s\.?(?:a\.?)?(?![a-z0-9])/g, "united states")
    .replace(/\bu\.?k\.?\b/g, "united kingdom")
    .replace(/\bnyc\b/g, "new york")
    .replace(/[|/]+/g, " ");
}

// State tokens may precede ZIPs or work-mode labels. Keep raw casing and
// separators: lowercase prose such as "Berlin or Munich" is not a state code.
const US_STATE_PATTERN =
  /\b(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|ia|id|il|in|ks|ky|la|ma|md|me|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|wy|dc|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)\b/gi;

// These ISO country codes collide with state abbreviations. Country names
// disambiguate the entire string; city hints cover common country-only forms.
const FOREIGN_COUNTRY_PATTERN = /\b(?:india|germany|canada)\b/i;
const FOREIGN_CITY_BY_CODE = new Map([
  ["in", /\b(?:bangalore|bengaluru)\b/i],
  ["de", /\bberlin\b/i],
  ["ca", /\btoronto\b/i],
]);

/** @param {string} location @param {string} acceptable */
function matchesLocation(location, acceptable) {
  const needle = normalizeLocationText(acceptable);
  const normalized = normalizeLocationText(location);
  if (matchesPhrase(normalized, needle)) return true;
  if (needle !== "united states" || FOREIGN_COUNTRY_PATTERN.test(location)) return false;
  return location.replace(/\bnyc\b/gi, "New York").split(/[;/|]+/).some((component) =>
    [...component.matchAll(US_STATE_PATTERN)].some((match) => {
      const token = match[0];
      if (token.length > 2) return true;
      if (/^(?:in|or|me|hi|ok|id)$/.test(token) && component.trim() !== token && !/,\s*$/.test(component.slice(0, match.index))) return false;
      return !FOREIGN_CITY_BY_CODE.get(token.toLowerCase())?.test(location);
    }),
  );
}

/**
 * @param {string | undefined} input
 * @returns {RemoteBucket}
 */
export function normalizeRemoteBucket(input) {
  const normalized = normalizeWhitespace(String(input || "")).toLowerCase();
  if (normalized === "remote") return "remote";
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "onsite" || normalized === "on-site" || normalized === "on site") {
    return "onsite";
  }
  return "unknown";
}

/**
 * An explicit bucket (a source flag, or the Sheet's Work Mode cell) wins;
 * otherwise the location, description, fit assessment and title are read
 * together, remote before hybrid before onsite. No signal is "unknown".
 * @param {{ remoteBucket?: string, location?: string, descriptionText?: string, fitAssessment?: string, title?: string }} input
 * @returns {RemoteBucket}
 */
export function inferRemoteBucket(input) {
  const explicit = normalizeRemoteBucket(input.remoteBucket);
  if (explicit !== "unknown") return explicit;

  const haystack = normalizeLocationText(
    [input.location, input.descriptionText, input.fitAssessment, input.title]
      .map((value) => stripHtml(value || ""))
      .filter(Boolean)
      .join(" "),
  );

  if (!haystack) return "unknown";
  // Remove denied signals without hiding a separate positive remote clause.
  const remoteSignal = REMOTE_LOCATION_PATTERN.source;
  const unnegated = haystack
    .replace(new RegExp(`\\b(?:no|not|never|without)(?:\\s+(?:a|an|any|fully|entirely)){0,3}\\s+${remoteSignal}`, "gi"), " ")
    .replace(new RegExp(`${remoteSignal}(?:\\s+(?:work|working|position|role))?\\s+(?:is|are)\\s+(?:not|never)\\b`, "gi"), " ");
  if (REMOTE_LOCATION_PATTERN.test(unnegated)) return "remote";
  if (HYBRID_LOCATION_PATTERN.test(haystack)) return "hybrid";
  if (ONSITE_LOCATION_PATTERN.test(haystack)) return "onsite";
  return "unknown";
}

/**
 * Whole-word, case-insensitive phrase match: "intern" finds "Intern" but not
 * "International", "ny" finds "New York, NY" but not "Germany". `suffix` is a
 * regex fragment allowed straight after the phrase.
 * @param {string} text
 * @param {string} phrase
 * @param {string} [suffix]
 */
export function matchesPhrase(text, phrase, suffix = "") {
  const needle = normalizeWhitespace(phrase).toLowerCase();
  if (!needle) return false;
  const body = escapeRegExp(needle).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${body}${suffix}(?![a-z0-9])`, "i").test(String(text || ""));
}

// A skip phrase also covers its plural and "-ship" form: "intern" skips
// "Interns" and "Internship", never "International".
const SKIP_TITLE_SUFFIX = "(?:s|es|ships?)?";

const PAY_PERIOD_TO_ANNUAL = new Map([
  ["hour", 2080],
  ["hr", 2080],
  ["day", 260],
  ["week", 52],
  ["wk", 52],
  ["month", 12],
  ["mo", 12],
  ["year", 1],
  ["yr", 1],
  ["annum", 1],
]);

// "<amount>[k][ - <amount>[k]] [/|per|a|an <period>]". A period counts only
// when it is attached to the amount, so "40 hours per week" is not pay.
const PAY_AMOUNT_PATTERN =
  /(\d[\d,]*(?:\.\d+)?)\s*(k)?(?:\s*(?:-|–|—|to)\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?)?(?:\s*(?:\/|\bper\b|\ban?\b)\s*(hour|hr|day|week|wk|month|mo|year|yr|annum)\b)?/g;

/**
 * The highest published pay, as annual dollars. Handles "$150k", "$150,000",
 * "150-180k", hourly, daily, weekly and monthly rates ("$45/hr", "$2,500 per
 * week"). A 401(k) or 403(b) plan is not pay. Bare numbers under 1,000 with no
 * "k" and no pay period are ignored (hours, years). Null when nothing parses.
 * @param {string} text
 * @returns {number | null}
 */
export function parseSalaryMax(text) {
  const cleaned = String(text || "")
    .replace(/\$/g, "")
    .toLowerCase()
    .replace(/\b40[13]\s*\(?\s*[kb]\s*\)?/g, " ");
  if (!cleaned.trim()) return null;

  /** @type {number[]} */
  const values = [];
  for (const match of cleaned.matchAll(PAY_AMOUNT_PATTERN)) {
    const [, low, lowK, high, highK, period] = match;
    const perYear = (period && PAY_PERIOD_TO_ANNUAL.get(period)) || 0;
    // "150-180k" carries the k on the high end only.
    const amounts = [
      { raw: low, k: Boolean(lowK || (high && highK)) },
      ...(high ? [{ raw: high, k: Boolean(highK) }] : []),
    ];
    for (const { raw, k } of amounts) {
      const parsed = Number.parseFloat(raw.replace(/,/g, ""));
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      const amount = k ? parsed * 1000 : parsed;
      if (perYear) {
        values.push(Math.round(amount * perYear));
      } else if (k || amount >= 1000) {
        values.push(amount);
      }
    }
  }
  return values.length ? Math.max(...values) : null;
}

const SPONSORSHIP_DENY_PHRASES = [
  "no sponsorship",
  "us citizens only",
  "must be authorized to work in the us without sponsorship",
  "no visa sponsorship",
];

/**
 * @typedef {object} PreFilterListing
 * @property {string} [title]
 * @property {string} [location]
 * @property {string} [remoteBucket]
 * @property {string} [descriptionText]
 * @property {string} [compensationText]
 */

/**
 * Loosely typed: rescore reads these straight from a stored profile.
 * @typedef {object} PreFilterHardConstraints
 * @property {unknown} [salaryFloor]
 * @property {unknown} [salaryRequired]
 * @property {unknown} [workMode]
 * @property {unknown[]} [acceptableLocations]
 * @property {unknown} [workAuth]
 * @property {unknown[]} [skipTitles]
 */

/**
 * @typedef {{ pass: true } | {
 *   pass: false,
 *   reason: "skip_title_match" | "work_mode_mismatch" | "location_outside_acceptable" | "work_auth_mismatch" | "salary_below_floor" | "salary_missing_but_required",
 *   detail: string,
 *   matchedPhrase?: string,
 *   remoteBucket?: string,
 * }} PreFilterResult
 */

/**
 * Apply hardConstraints to a listing, cheapest checks first. Returns the
 * first violation; never aggregates.
 * @param {PreFilterListing} rawListing
 * @param {{ hardConstraints?: PreFilterHardConstraints }} profile
 * @returns {PreFilterResult}
 */
export function runPreFilter(rawListing, profile) {
  const hc = (profile && profile.hardConstraints) || {};

  // 1. skipTitles, as whole words.
  const title = String(rawListing.title || "");
  for (const phrase of hc.skipTitles || []) {
    const needle = String(phrase || "").trim();
    if (needle && matchesPhrase(title, needle, SKIP_TITLE_SUFFIX)) {
      return {
        pass: false,
        reason: "skip_title_match",
        detail: `Title contains skip phrase "${phrase}".`,
        matchedPhrase: needle,
      };
    }
  }

  // 2. remote_only needs an explicit or inferred "remote"; "unknown" fails
  //    and says so rather than reading as "onsite".
  const remoteBucket = inferRemoteBucket(rawListing);
  if (hc.workMode === "remote_only") {
    if (remoteBucket !== "remote") {
      return {
        pass: false,
        reason: "work_mode_mismatch",
        detail: `Profile requires remote_only; listing remoteBucket=${remoteBucket}.`,
        remoteBucket,
      };
    }
  }

  // 3. Location constrains non-remote roles; remote roles remain eligible.
  //    Place names use whole words; US aliases also accept city/state text.
  if (remoteBucket !== "remote" && (hc.workMode === "hybrid_ok" || hc.workMode === "onsite_ok")) {
    const acceptable = (hc.acceptableLocations || [])
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean);
    if (acceptable.length > 0) {
      const location = String(rawListing.location || "");
      const matches = acceptable.some((loc) => matchesLocation(location, loc));
      if (!matches) {
        return {
          pass: false,
          reason: "location_outside_acceptable",
          detail: `Location "${rawListing.location || ""}" outside acceptableLocations [${acceptable.join(", ")}].`,
        };
      }
    }
  }

  // 4. needs_sponsorship and the description says there is none.
  if (hc.workAuth === "needs_sponsorship") {
    const descLower = String(rawListing.descriptionText || "").toLowerCase();
    for (const phrase of SPONSORSHIP_DENY_PHRASES) {
      if (descLower.includes(phrase)) {
        return {
          pass: false,
          reason: "work_auth_mismatch",
          detail: `Listing description signals "${phrase}".`,
        };
      }
    }
  }

  // 5. salaryRequired owns only the missing-salary rejection. A published
  //    salary below salaryFloor rejects independently of that checkbox.
  const parsedMax = parseSalaryMax(rawListing.compensationText || "");
  if (parsedMax === null) {
    if (hc.salaryRequired) {
      return {
        pass: false,
        reason: "salary_missing_but_required",
        detail: "Profile requires published salary; listing has none.",
      };
    }
  } else if (typeof hc.salaryFloor === "number" && parsedMax < hc.salaryFloor) {
    return {
      pass: false,
      reason: "salary_below_floor",
      detail: `Parsed salary ${parsedMax} below floor ${hc.salaryFloor}.`,
    };
  }

  return { pass: true };
}
