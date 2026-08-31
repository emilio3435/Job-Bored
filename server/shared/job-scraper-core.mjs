/**
 * Cheerio-based job posting extraction (JSON-LD JobPosting + DOM heuristics).
 * Produces a stable JSON shape for the dashboard; DOM noise (nav, footers, ads)
 * is stripped before text extraction.
 */
import * as cheerio from "cheerio";
import { validateScrapeTarget, safeFetch } from "../security-boundaries.mjs";

/** @typedef {import("./job-scraper-core.d.mts").ScrapeJobPostingOptions} ScrapeJobPostingOptions */
/** @typedef {import("./job-scraper-core.d.mts").ScrapeJobPostingResult} ScrapeJobPostingResult */
/** @typedef {Record<string, unknown>} UnknownRecord */
/** @typedef {import("cheerio").CheerioAPI} CheerioApi */
/** @typedef {import("cheerio").Cheerio<import("domhandler").AnyNode>} CheerioSelection */

const FETCH_TIMEOUT_MS = 18000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const SERPAPI_TIMEOUT_MS = 12000;

const UA =
  "Mozilla/5.0 (compatible; CommandCenterJobBot/1.0; +https://github.com/job-bored) AppleWebKit/537.36 Chrome/120 Safari/537.36";

/** [lowercase needle, display label] for skill chips */
const KNOWN_SKILLS = [
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["python", "Python"],
  ["java", "Java"],
  ["golang", "Go"],
  ["rust", "Rust"],
  ["ruby", "Ruby"],
  ["php", "PHP"],
  ["react", "React"],
  ["vue", "Vue"],
  ["angular", "Angular"],
  ["svelte", "Svelte"],
  ["next.js", "Next.js"],
  ["node.js", "Node.js"],
  ["django", "Django"],
  ["flask", "Flask"],
  ["fastapi", "FastAPI"],
  ["docker", "Docker"],
  ["terraform", "Terraform"],
  ["postgresql", "PostgreSQL"],
  ["mysql", "MySQL"],
  ["mongodb", "MongoDB"],
  ["redis", "Redis"],
  ["kafka", "Kafka"],
  ["graphql", "GraphQL"],
  ["grpc", "gRPC"],
  ["elasticsearch", "Elasticsearch"],
  ["snowflake", "Snowflake"],
  ["databricks", "Databricks"],
  ["pytorch", "PyTorch"],
  ["tensorflow", "TensorFlow"],
  ["kubernetes", "Kubernetes"],
  ["aws", "AWS"],
  ["azure", "Azure"],
  ["gcp", "GCP"],
  ["machine learning", "Machine learning"],
  ["deep learning", "Deep learning"],
  ["nlp", "NLP"],
  ["llm", "LLM"],
  ["claude", "Claude"],
  ["cursor", "Cursor"],
  ["ci/cd", "CI/CD"],
  ["microservices", "Microservices"],
  ["oauth", "OAuth"],
  ["saml", "SAML"],
  ["soc 2", "SOC 2"],
  ["hipaa", "HIPAA"],
];

/** Short lines that are almost always global nav / job-board chrome, not role requirements */
const JUNK_BULLET_LINE = new RegExp(
  `^(` +
    [
      "hire on",
      "post a job",
      "companies",
      "articles",
      "salaries",
      "job application tracker",
      "built in",
      "sign in",
      "log in",
      "get started",
      "post a free job",
      "browse jobs",
      "for employers",
      "for job seekers",
    ].join("|") +
    ")\\b",
  "i",
);

/** If many bullets match this, the whole extraction is probably nav-heavy */
const JUNK_BULLET_FRACTION = 0.35;

/** Penalize JSON-LD blobs that look like site chrome or wrong product pitch */
/** @param {string} text */
function ldTextLooksLikeNoise(text) {
  if (!text || text.length < 40) return true;
  const low = text.toLowerCase();
  if (/\b(hire on built in|post a job|job application tracker)\b/i.test(text))
    return true;
  if (
    /\bapollo\.io\b/i.test(low) &&
    /\bgo-?to-?market\b/i.test(low) &&
    !/\bscale\b/i.test(low)
  ) {
    return true;
  }
  return false;
}

/** Reject fake “skills” from investor / About sections */
const SKILL_DENYLIST = new Set(
  [
    "founded",
    "by",
    "sequoia",
    "capital",
    "bain",
    "ventures",
    "president",
    "investors",
    "board",
    "series",
    "funding",
    "headquarters",
    "employees",
    "million",
    "billion",
  ].map((s) => s.toLowerCase()),
);

/** @param {unknown} s */
function normalizeSpace(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** @param {unknown} value */
function normalizeMatchText(value) {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** @param {unknown} value */
function tokenSet(value) {
  return new Set(
    normalizeMatchText(value)
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
function tokenOverlapRatio(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let hits = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) hits += 1;
  }
  return hits / Math.max(leftTokens.size, 1);
}

/** @param {string} url */
function linkedInJobId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "linkedin.com") return "";

  const pathJobId = linkedInPathJobId(parsed);
  if (pathJobId) return pathJobId;

  const queryJobId = String(parsed.searchParams.get("currentJobId") || "").trim();
  if (/^\d{5,}$/.test(queryJobId)) return queryJobId;
  const hashMatch = parsed.hash.match(/(?:^#|[?#&])currentJobId=(\d{5,})(?:\D|$)/i);
  return hashMatch ? hashMatch[1] : "";
}

/** @param {URL} parsed */
function linkedInPathJobId(parsed) {
  const segments = parsed.pathname.split("/").filter(Boolean);
  const jobPostingIndex = segments.findIndex((segment) => segment === "jobPosting");
  if (jobPostingIndex >= 0) {
    const jobPostingId = String(segments[jobPostingIndex + 1] || "").trim();
    if (/^\d{5,}$/.test(jobPostingId)) return jobPostingId;
  }

  const jobsIndex = segments.findIndex(
    (segment, index) => segment === "jobs" && segments[index + 1] === "view",
  );
  if (jobsIndex < 0) return "";
  const detailToken = String(segments[jobsIndex + 2] || "").trim();
  const match = detailToken.match(/(?:^|\D)(\d{5,})(?:\D*)$/);
  return match ? match[1] : "";
}

/** @param {ScrapeJobPostingOptions} [options] */
function getSerpApiKey(options = {}) {
  return String(
    options.serpApiKey ||
      process.env.BROWSER_USE_DISCOVERY_SERPAPI_API_KEY ||
      process.env.DISCOVERY_SERPAPI_API_KEY ||
      process.env.SERPAPI_API_KEY ||
      "",
  ).trim();
}

const PLACEHOLDER_EMPLOYER_LABELS = new Set([
  "careers",
  "career",
  "linkedin",
  "jobs",
  "job",
  "apply",
  "job board",
  "job boards",
  "job site",
  "unknown company",
  "unknown",
]);

/**
 * @param {string} name
 * @param {string} [url]
 */
export function sanitizeInferredEmployer(name, url = "") {
  const cleaned = normalizeSpace(name);
  if (!cleaned) return "";
  const label = normalizeMatchText(cleaned);
  if (PLACEHOLDER_EMPLOYER_LABELS.has(label)) return "";
  let hostLabel = "";
  try {
    hostLabel = new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .split(".")[0]
      .replace(/[-_]+/g, " ")
      .trim();
  } catch {
    hostLabel = "";
  }
  if (hostLabel && label === hostLabel && PLACEHOLDER_EMPLOYER_LABELS.has(hostLabel)) {
    return "";
  }
  return cleaned;
}

/**
 * @param {Pick<ScrapeJobPostingOptions, "title" | "company">} [options]
 * @param {string} [originalUrl]
 */
function buildSerpApiQuery(options = {}, originalUrl = "") {
  const title = normalizeSpace(options.title || "");
  const company = normalizeSpace(options.company || "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const fromContext = [title, company].filter(Boolean).join(" ").trim();
  if (fromContext) return fromContext;
  const jobId = linkedInJobId(originalUrl);
  return jobId ? `linkedin ${jobId}` : "";
}

/**
 * @param {UnknownRecord} raw
 * @returns {string[]}
 */
function collectSerpApiCandidateUrls(raw) {
  /** @type {string[]} */
  const candidates = [];
  /** @param {unknown} value */
  const push = (value) => {
    if (typeof value === "string" && /^https?:/i.test(value)) candidates.push(value);
  };
  const rawApplyOptions = raw && raw.apply_options;
  const applyOptions = Array.isArray(rawApplyOptions)
    ? rawApplyOptions
    : [];
  for (const option of applyOptions) {
    if (option && typeof option === "object" && "link" in option) push(option.link);
  }
  const rawRelatedLinks = raw && raw.related_links;
  const relatedLinks = Array.isArray(rawRelatedLinks)
    ? rawRelatedLinks
    : [];
  for (const link of relatedLinks) {
    if (link && typeof link === "object" && "link" in link) push(link.link);
  }
  push(raw && raw.share_link);
  return candidates;
}

/**
 * @param {UnknownRecord} raw
 * @param {string} originalUrl
 */
function pickSerpApiUrl(raw, originalUrl) {
  const candidates = collectSerpApiCandidateUrls(raw);
  const originalId = linkedInJobId(originalUrl);
  if (originalId) {
    const exact = candidates.find((url) => linkedInJobId(url) === originalId);
    if (exact) return exact;
  }
  const nonLinkedIn = candidates.find((url) => !/\/\/([^/]+\.)?linkedin\.com\//i.test(url));
  return nonLinkedIn || candidates[0] || originalUrl;
}

/** @param {string} url */
function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * @param {UnknownRecord} raw
 * @param {{ title: string, company: string }} context
 * @param {string} originalUrl
 */
function scoreSerpApiJob(raw, context, originalUrl) {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const company = typeof raw.company_name === "string" ? raw.company_name.trim() : "";
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  if (!title || !company || description.length < 80) return -Infinity;

  const originalId = linkedInJobId(originalUrl);
  const originalHost = hostnameOf(originalUrl);
  const candidates = collectSerpApiCandidateUrls(raw);
  const idMatch = Boolean(
    originalId && candidates.some((url) => linkedInJobId(url) === originalId),
  );
  const urlMatch = Boolean(
    originalUrl &&
      candidates.some(
        (url) => String(url || "").replace(/\/+$/, "") === originalUrl.replace(/\/+$/, ""),
      ),
  );
  const hostMatch = Boolean(
    originalHost && candidates.some((url) => hostnameOf(url) === originalHost),
  );
  const titleOverlap = context.title ? tokenOverlapRatio(context.title, title) : 0;
  const companyOverlap = context.company
    ? tokenOverlapRatio(context.company, company)
    : 0;

  // Title/company-only hits must actually look like the same job. A generic
  // title like "Engineer" plus a dummy company like "Test" must not pick a
  // random Google Jobs listing from another employer.
  if (!idMatch && !urlMatch) {
    if (context.company && companyOverlap < 0.4) return -Infinity;
    if (context.title && titleOverlap < 0.3) return -Infinity;
  }

  let score = 0;
  if (idMatch) score += 200;
  if (urlMatch) score += 120;
  else if (hostMatch) score += 80;
  if (context.title) score += titleOverlap * 120;
  if (context.company) score += companyOverlap * 90;
  if (description.length > 400) score += 20;
  return score;
}

/**
 * @param {unknown[]} jobs
 * @param {{ title: string, company: string }} context
 * @param {string} originalUrl
 * @returns {UnknownRecord | null}
 */
function pickSerpApiJob(jobs, context, originalUrl) {
  let best = null;
  let bestScore = -Infinity;
  for (const raw of jobs) {
    if (!raw || typeof raw !== "object") continue;
    const score = scoreSerpApiJob(
      /** @type {UnknownRecord} */ (raw),
      context,
      originalUrl,
    );
    if (score > bestScore) {
      best = /** @type {UnknownRecord} */ (raw);
      bestScore = score;
    }
  }
  return bestScore >= 70 ? best : null;
}

/**
 * @param {string} query
 * @param {string} apiKey
 * @param {typeof globalThis.fetch} fetchImpl
 * @returns {Promise<unknown[]>}
 */
async function fetchSerpApiJobs(query, apiKey, fetchImpl) {
  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_jobs");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("google_domain", "google.com");
  url.searchParams.set("num", "10");
  url.searchParams.set("api_key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERPAPI_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`SerpApi HTTP ${response.status}`);
    const body = await response.json();
    return body &&
      typeof body === "object" &&
      "jobs_results" in body &&
      Array.isArray(body.jobs_results)
      ? body.jobs_results
      : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} originalUrl
 * @param {ScrapeJobPostingOptions} [options]
 * @returns {Promise<ScrapeJobPostingResult | null>}
 */
async function scrapeViaSerpApiGoogleJobs(originalUrl, options = {}) {
  const context = {
    title: normalizeSpace(options.title || ""),
    company: normalizeSpace(options.company || ""),
  };
  const query = buildSerpApiQuery(context, originalUrl);
  const apiKey = getSerpApiKey(options);
  if (!query || !apiKey) return null;

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const jobs = await fetchSerpApiJobs(query, apiKey, fetchImpl);
  const matched = pickSerpApiJob(jobs, context, originalUrl);
  if (!matched) return null;

  const description = normalizeSpace(matched.description || "").slice(0, 25000);
  const requirements = filterJunkBullets(guessRequirementsFromText(description));
  const skills = extractSkillsFromText(description, requirements);
  return {
    url: pickSerpApiUrl(matched, originalUrl),
    sourceUrl: originalUrl,
    title: normalizeSpace(matched.title || context.title) || null,
    company: normalizeSpace(matched.company_name || context.company),
    location: normalizeSpace(matched.location || ""),
    description,
    requirements,
    skills,
    source: "serpapi-google-jobs",
    method: "serpapi-google-jobs",
    scraping: {
      provider: "serpapi_google_jobs",
      query,
      originalUrl,
      matchedUrl: pickSerpApiUrl(matched, originalUrl),
      lineage: {
        primary: "linkedin-direct",
        used: "serpapi-google-jobs",
        fallbackFrom: "linkedin-direct",
        reason: "linkedin_serpapi_fallback",
      },
    },
    warnings: [
      "Direct scrape was replaced with a Google Jobs structured fallback.",
    ],
  };
}

/** @param {unknown} html */
function stripTags(html) {
  if (!html || typeof html !== "string") return "";
  const $ = cheerio.load(html);
  return normalizeSpace($.text());
}

/**
 * @param {CheerioApi} $
 * @returns {unknown[]}
 */
function collectJsonLdBlocks($) {
  /** @type {unknown[]} */
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      const j = JSON.parse(raw.trim());
      if (Array.isArray(j)) out.push(...j);
      else out.push(j);
    } catch {
      /* ignore */
    }
  });
  return out;
}

/**
 * @param {unknown[]} blocks
 * @returns {UnknownRecord[]}
 */
function findJobPostingObjects(blocks) {
  /** @type {UnknownRecord[]} */
  const jobs = [];
  /** @param {unknown} node */
  function walk(node) {
    if (!node || typeof node !== "object") return;
    const record = /** @type {UnknownRecord} */ (node);
    const t = record["@type"];
    const types = Array.isArray(t) ? t : t ? [t] : [];
    if (types.some((x) => String(x).toLowerCase() === "jobposting")) {
      jobs.push(record);
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
    } else {
      for (const k of Object.keys(record)) {
        if (k === "@context") continue;
        walk(record[k]);
      }
    }
  }
  for (const b of blocks) walk(b);
  return jobs;
}

/** @param {unknown} value */
function organizationName(value) {
  if (typeof value === "string") return normalizeSpace(value);
  if (!value || typeof value !== "object") return "";
  const record = /** @type {UnknownRecord} */ (value);
  return normalizeSpace(record.name || record.legalName || "");
}

/**
 * @param {unknown} value
 * @param {string[]} acc
 */
function collectLocationParts(value, acc) {
  if (!value) return acc;
  if (Array.isArray(value)) {
    for (const entry of value) collectLocationParts(entry, acc);
    return acc;
  }
  if (typeof value === "string") {
    const text = normalizeSpace(value);
    if (text) acc.push(text);
    return acc;
  }
  if (typeof value !== "object") return acc;
  const record = /** @type {UnknownRecord} */ (value);
  const address = record.address;
  if (address && typeof address === "object") {
    const addr = /** @type {UnknownRecord} */ (address);
    const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
      .map((part) => organizationName(part) || normalizeSpace(part))
      .filter(Boolean);
    if (parts.length) acc.push(parts.join(", "));
  }
  const named = organizationName(record);
  if (named) acc.push(named);
  return acc;
}

/** @param {UnknownRecord} j */
function employerFromJobPostingLd(j) {
  return organizationName(j.hiringOrganization);
}

/** @param {UnknownRecord} j */
function locationFromJobPostingLd(j) {
  /** @type {string[]} */
  const parts = [];
  collectLocationParts(j.jobLocation, parts);
  collectLocationParts(j.applicantLocationRequirements, parts);
  if (typeof j.jobLocationType === "string" && /TELECOMMUTE/i.test(j.jobLocationType)) {
    parts.push("Remote");
  }
  return [...new Set(parts.filter(Boolean))].join(" · ");
}

/** @param {CheerioApi} $ */
function employerFromDom($) {
  const itemprop = normalizeSpace(
    $('[itemprop="hiringOrganization"] [itemprop="name"]').first().text(),
  );
  if (itemprop) return itemprop;
  return normalizeSpace($('meta[property="og:site_name"]').attr("content") || "");
}

/** @param {CheerioApi} $ */
function locationFromDom($) {
  const itemprop = normalizeSpace(
    $('[itemprop="jobLocation"] [itemprop="name"], [itemprop="jobLocation"]').first().text(),
  );
  return itemprop;
}

/** @param {UnknownRecord} j */
function textFromJobPostingLd(j) {
  const title = j.title || j.name || null;
  let desc = "";
  const d = j.description;
  if (typeof d === "string") {
    desc = d.includes("<") ? stripTags(d) : normalizeSpace(d);
  } else if (d && typeof d === "object" && "@type" in d && d["@type"] === "HTMLString") {
    desc = stripTags(String("value" in d ? d.value || d : d));
  }
  const qual =
    j.qualifications ||
    j.skills ||
    j.responsibilities ||
    j.experienceRequirements;
  let extra = "";
  if (typeof qual === "string") extra += "\n\n" + normalizeSpace(qual);
  else if (qual && typeof qual === "object") {
    extra += "\n\n" + normalizeSpace(JSON.stringify(qual));
  }
  return { title: title ? String(title) : null, text: normalizeSpace(desc + extra) };
}

/**
 * Pick the JobPosting block whose description is most likely the real role
 * (longest substantive text, penalized for nav-like content).
 * @param {UnknownRecord[]} jobPostings
 * @returns {UnknownRecord | null}
 */
function pickBestJobPostingLd(jobPostings) {
  if (!jobPostings.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const j of jobPostings) {
    const { text } = textFromJobPostingLd(j);
    if (!text || text.length < 80) continue;
    let score = Math.min(text.length, 25000);
    const low = text.toLowerCase();
    if (/\b(hire on built in|post a job|job application tracker)\b/i.test(text))
      score -= 12000;
    if (
      /\bapollo\.io\b/i.test(low) &&
      j.hiringOrganization &&
      typeof j.hiringOrganization === "object"
    ) {
      const org = /** @type {UnknownRecord} */ (j.hiringOrganization);
      const orgName = String(org.name || "").toLowerCase();
      if (orgName && !orgName.includes("apollo") && low.includes("apollo"))
        score -= 8000;
    }
    if (j.datePosted) score += 50;
    if (
      j.hiringOrganization &&
      typeof j.hiringOrganization === "object" &&
      "name" in j.hiringOrganization &&
      j.hiringOrganization.name
    ) {
      score += 80;
    }
    if (j.baseSalary || j.salaryCurrency) score += 40;
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return best;
}

/**
 * Remove global chrome before we read paragraphs/lists (JSON-LD is collected first).
 * @param {CheerioApi} $
 */
function pruneDomForJobExtraction($) {
  $(
    "script, style, noscript, svg, template, iframe, picture, canvas, video, audio",
  ).remove();
  $("header, footer, nav, [role='navigation'], aside, [role='complementary']").remove();
  $(
    "[class*='cookie'], [id*='cookie'], [class*='consent'], [id*='consent'], [data-testid*='nav'], [class*='global-nav'], [class*='site-header'], [class*='site-footer'], [class*='job-board-nav']",
  ).remove();
}

/** Prefer specific job regions; keep broad selectors last so we do not grab the whole site */
const DESCRIPTION_SELECTORS_SPECIFIC = [
  "[data-job-description]",
  "[data-testid='job-description']",
  "[data-test='job-description']",
  "[data-testid*='job-description']",
  ".job-description",
  ".job-description-view",
  ".description__text",
  "#job-description",
  ".job-details",
  ".posting-content",
  "article.job-description",
  "[itemtype*='JobPosting']",
];

const DESCRIPTION_SELECTORS_BROAD = [
  '[role="main"]',
  "#main",
  ".main-content",
  "main",
  "article",
  ".content",
];

/**
 * @param {CheerioApi} $
 * @returns {{ text: string, containerSelector: string | null, $container: CheerioSelection | null }}
 */
function findBestDescriptionFromDom($) {
  let best = "";
  /** @type {string | null} */
  let containerSelector = null;
  /** @type {CheerioSelection | null} */
  let $bestEl = null;

  /**
   * @param {string} sel
   * @param {number} minLen
   * @param {boolean} broad
   */
  const trySel = (sel, minLen, broad) => {
    $(sel).each((_, node) => {
      const $el = $(node);
      const t = normalizeSpace($el.text());
      if (t.length > best.length && t.length >= minLen) {
        if (broad && t.length > 80000) return;
        best = t;
        containerSelector = sel;
        $bestEl = $el;
      }
    });
  };

  for (const sel of DESCRIPTION_SELECTORS_SPECIFIC) {
    trySel(sel, 120, false);
  }
  if (best.length >= 400 && $bestEl)
    return { text: best, containerSelector, $container: $bestEl };

  for (const sel of DESCRIPTION_SELECTORS_BROAD) {
    trySel(sel, 200, true);
  }
  if (best.length >= 200 && $bestEl)
    return { text: best, containerSelector, $container: $bestEl };

  const fallback = largestTextBlock($, $.root());
  return {
    text: fallback,
    containerSelector: fallback.length > 80 ? "(largest block)" : null,
    $container: null,
  };
}

/**
 * @param {CheerioApi} $
 * @param {CheerioSelection} root
 */
function largestTextBlock($, root) {
  let best = "";
  const scope = root && root.length ? root : $.root();
  scope.find("p, li, div").each((_, el) => {
    const t = normalizeSpace($(el).text());
    if (t.length > best.length && t.length < 120000) best = t;
  });
  return best;
}

/**
 * @param {CheerioApi} $
 * @param {string[]} keywords
 * @param {CheerioSelection | null} scope
 */
function extractSectionBullets($, keywords, scope) {
  /** @type {string[]} */
  const bullets = [];
  const lower = keywords.map((k) => k.toLowerCase());
  const $root = scope && scope.length ? scope : $.root();
  $root.find("h1, h2, h3, h4, h5, h6, strong, b").each((_, el) => {
    const heading = normalizeSpace($(el).text()).toLowerCase();
    if (!heading) return;
    const hit = lower.some((k) => heading.includes(k));
    if (!hit) return;
    let $n = $(el).next();
    let guard = 0;
    while ($n.length && guard++ < 40) {
      const name = ($n[0] && $n[0].name) || "";
      if (/^h[1-6]$/i.test(name)) break;
      if (name === "ul" || name === "ol") {
        $n.find("li").each((__, li) => {
          const line = normalizeSpace($(li).text());
          if (line.length > 2 && line.length < 800) bullets.push(line);
        });
        break;
      }
      if (name === "p") {
        const line = normalizeSpace($n.text());
        if (line.length > 20 && line.length < 800) bullets.push(line);
        break;
      }
      $n = $n.next();
    }
  });
  return bullets;
}

/**
 * @param {CheerioApi} $
 * @param {CheerioSelection | null} scope
 * @param {number} [max]
 */
function extractListBullets($, scope, max = 50) {
  /** @type {string[]} */
  const out = [];
  const $root = scope && scope.length ? scope : $.root();
  $root.find("ul li, ol li").each((_, li) => {
    const t = normalizeSpace($(li).text());
    if (t.length > 8 && t.length < 600 && !out.includes(t)) out.push(t);
  });
  return out.slice(0, max);
}

/** @param {string[]} bullets */
function filterJunkBullets(bullets) {
  /** @type {string[]} */
  const out = [];
  for (const b of bullets) {
    const s = String(b).trim();
    if (s.length < 10) continue;
    if (JUNK_BULLET_LINE.test(s)) continue;
    if (/^(home|careers|about|blog|pricing|resources)\s*$/i.test(s)) continue;
    out.push(s);
  }
  return out;
}

/** @param {string} text */
function guessRequirementsFromText(text) {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const req = [];
  const lower = text.toLowerCase();
  const sectionIdx = lines.findIndex((l) =>
    /^(requirements|qualifications|what you|what we|you have|must have|minimum|required skills|preferred skills)/i.test(
      l.slice(0, 80),
    ),
  );
  if (sectionIdx >= 0) {
    for (let i = sectionIdx + 1; i < Math.min(lines.length, sectionIdx + 40); i++) {
      const l = lines[i];
      if (/^#{1,4}\s/.test(l)) break;
      if (/^(benefits|about|company|apply)/i.test(l)) break;
      if (/^[•\-\*]\s/.test(l) || /^\d+\.\s/.test(l)) {
        const cleaned = l.replace(/^[•\-\*]\s*/, "").replace(/^\d+\.\s*/, "").trim();
        if (!JUNK_BULLET_LINE.test(cleaned)) req.push(cleaned);
      } else if (l.length < 200 && l.length > 8 && !JUNK_BULLET_LINE.test(l)) {
        req.push(l);
      }
    }
  }
  if (req.length === 0 && lower.includes("requirement")) {
    for (const l of lines) {
      if (
        /^[•\-\*]\s/.test(l) &&
        l.length < 400 &&
        !JUNK_BULLET_LINE.test(l)
      ) {
        req.push(l.replace(/^[•\-\*]\s*/, "").trim());
      }
    }
  }
  return req.slice(0, 30);
}

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Skills = known tech terms found in text (no generic Title Case word harvesting).
 * @param {string} text
 * @param {string[]} requirements
 */
function extractSkillsFromText(text, requirements) {
  const bag = new Set();
  const blob = normalizeSpace(`${text}\n${requirements.join("\n")}`);
  for (const [word, label] of KNOWN_SKILLS) {
    if (word.length < 2) continue;
    if (new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(blob)) {
      bag.add(label);
    }
  }
  if (/\bgoogle\s+cloud\b/i.test(blob)) bag.add("GCP");
  if (/\bci\s*\/\s*cd\b/i.test(blob)) bag.add("CI/CD");
  if (/\bsoc\s*2\b/i.test(blob)) bag.add("SOC 2");
  // Short acronyms often used in job posts (2–5 chars, all caps)
  const acronymRe = /\b([A-Z]{2,5})\b/g;
  let m;
  const allowAcronym = new Set([
    "API",
    "SDK",
    "UI",
    "UX",
    "SQL",
    "ETL",
    "ML",
    "AI",
    "KPI",
    "SEO",
    "SEM",
    "CRM",
    "CDN",
    "IAM",
    "SSO",
    "SLA",
    "QA",
    "PM",
    "VP",
    "B2B",
    "B2C",
    "SMB",
    "CTV",
    "DSP",
    "DMP",
    "SSP",
  ]);
  while ((m = acronymRe.exec(blob))) {
    if (allowAcronym.has(m[1])) bag.add(m[1]);
  }
  return [...bag]
    .filter((label) => !SKILL_DENYLIST.has(label.toLowerCase()))
    .slice(0, 40);
}

/**
 * @param {string} url
 * @param {ScrapeJobPostingOptions} [options]
 * @returns {Promise<ScrapeJobPostingResult>}
 */
export async function scrapeJobPosting(url, options = {}) {
  const target = validateScrapeTarget(url);
  if (!target.ok) {
    throw new Error(target.error);
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let html;
  try {
    const res = await safeFetch(
      target.url,
      {
        signal: controller.signal,
        headers: {
          "User-Agent": UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      { fetchImpl },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) {
      throw new Error("Page too large");
    }
    html = new TextDecoder("utf-8").decode(buf);
  } catch (error) {
    const serpFallback = await scrapeViaSerpApiGoogleJobs(target.url, {
      ...options,
      fetchImpl,
    }).catch(() => null);
    if (serpFallback) return serpFallback;
    throw error;
  } finally {
    clearTimeout(t);
  }

  const $ = cheerio.load(html);
  const warnings = [];

  let title = normalizeSpace($("title").first().text()) || null;
  let description = "";
  let method = "dom";
  let containerUsed = null;
  /** @type {{ primary: string, used: string, fallbackFrom?: string, reason?: string }} */
  const lineage = { primary: "dom", used: "dom" };

  const blocks = collectJsonLdBlocks($);
  const jobPostings = findJobPostingObjects(blocks);
  const bestJp = pickBestJobPostingLd(jobPostings);

  let ldTitle = null;
  let ldText = "";
  if (bestJp) {
    const ld = textFromJobPostingLd(bestJp);
    ldText = ld.text;
    ldTitle = ld.title;
  }

  pruneDomForJobExtraction($);

  const domPick = findBestDescriptionFromDom($);
  const domText = domPick.text;
  containerUsed = domPick.containerSelector;
  const $jobRoot = domPick.$container;

  if (ldText && ldText.length >= 120 && !ldTextLooksLikeNoise(ldText)) {
    description = ldText;
    if (ldTitle) title = ldTitle;
    method = "json-ld";
    lineage.primary = "json-ld";
    lineage.used = "json-ld";
    if (domText.length > description.length * 1.4 && domText.length > 500) {
      warnings.push(
        "JSON-LD used but a larger DOM block was found; if the description looks wrong, the page may embed multiple postings or ads.",
      );
    }
  } else {
    if (bestJp && ldTextLooksLikeNoise(ldText)) {
      warnings.push(
        "JSON-LD description looked like site chrome or unrelated content; fell back to DOM extraction.",
      );
      lineage.primary = "json-ld";
      lineage.fallbackFrom = "json-ld";
      lineage.reason = "json_ld_noise";
    } else if (bestJp) {
      lineage.primary = "json-ld";
      lineage.fallbackFrom = "json-ld";
      lineage.reason = "json_ld_thin";
    }
    description = domText;
    method = domText.length >= 80 ? "dom" : "dom-fallback";
    lineage.used = method;
    if (!description || description.length < 80) {
      description = largestTextBlock($, $.root());
      method = "dom-fallback";
      lineage.used = "dom-fallback";
      containerUsed = "(largest block)";
    }
  }

  if (
    ldText &&
    ldTextLooksLikeNoise(ldText) &&
    domText &&
    domText.length > 200
  ) {
    description = domText;
    method = "dom";
    lineage.used = "dom";
    if (!lineage.fallbackFrom && bestJp) {
      lineage.primary = "json-ld";
      lineage.fallbackFrom = "json-ld";
      lineage.reason = lineage.reason || "json_ld_noise";
    }
    if (ldTitle && (!title || title.length < 5)) title = ldTitle;
  }

  const scope = $jobRoot && $jobRoot.length ? $jobRoot : $.root();

  const sectionBullets = filterJunkBullets(
    extractSectionBullets(
      $,
      [
        "requirement",
        "qualification",
        "skill",
        "experience",
        "responsibilit",
        "you have",
        "you will",
        "what you",
      ],
      scope,
    ),
  );
  let listBullets = filterJunkBullets(extractListBullets($, scope));

  const junkCount = listBullets.filter((b) => JUNK_BULLET_LINE.test(b)).length;
  if (
    listBullets.length > 5 &&
    junkCount / listBullets.length > JUNK_BULLET_FRACTION
  ) {
    warnings.push(
      "Many list items looked like site navigation; trimmed using heuristics.",
    );
    listBullets = listBullets.filter((b) => !JUNK_BULLET_LINE.test(b));
  }

  let requirements = [...new Set([...sectionBullets, ...listBullets])].filter(
    (x) => x.length > 5,
  );

  if (requirements.length < 4) {
    requirements = [
      ...requirements,
      ...filterJunkBullets(guessRequirementsFromText(description)),
    ];
    requirements = [...new Set(requirements)].slice(0, 35);
  } else {
    requirements = requirements.slice(0, 35);
  }

  const skills = extractSkillsFromText(description, requirements);

  description = description.slice(0, 25000);

  if (description.length < 160) {
    const serpFallback = await scrapeViaSerpApiGoogleJobs(target.url, {
      ...options,
      fetchImpl,
    }).catch(() => null);
    if (serpFallback) return serpFallback;
  }

  const company = sanitizeInferredEmployer(
    (bestJp && employerFromJobPostingLd(bestJp)) || employerFromDom($),
    target.url,
  );
  const location =
    (bestJp && locationFromJobPostingLd(bestJp)) || locationFromDom($) || "";

  return {
    url: target.url,
    title: title || null,
    company: company || undefined,
    location: location || undefined,
    description,
    requirements,
    skills,
    source: method,
    method,
    scraping: {
      jsonLdCandidates: jobPostings.length,
      containerHint: containerUsed,
      lineage,
    },
    warnings,
  };
}
