/**
 * Public ATS JSON fetchers for a single job URL.
 * These endpoints do not need API keys. Used by the Cheerio scraper before
 * it trusts hosted HTML, which is often an SPA shell or a careers listing.
 */
import { validateScrapeTarget, safeFetch } from "../security-boundaries.mjs";

const ATS_TIMEOUT_MS = 12000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * @param {unknown} rawUrl
 * @returns {{ provider: string, slug?: string, jobId?: string, tenant?: string, site?: string, jobPath?: string, origin?: string } | null}
 */
export function parseAtsJobIdentity(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname
    .split("/")
    .map((part) => safeDecode(part).trim())
    .filter(Boolean);

  if (
    host === "boards.greenhouse.io" ||
    host === "boards.eu.greenhouse.io" ||
    host === "job-boards.greenhouse.io"
  ) {
    if (segments[0] === "embed" && segments[1] === "job_app") {
      const slug = String(parsed.searchParams.get("for") || "").trim();
      const jobId = String(
        parsed.searchParams.get("token") || parsed.searchParams.get("gh_jid") || "",
      ).trim();
      return slug && jobId ? { provider: "greenhouse", slug, jobId } : null;
    }
    if (segments.length >= 3 && segments[1] === "jobs") {
      const slug = segments[0] || "";
      const jobId = (segments[2] || "").replace(/[?#].*$/, "");
      return slug && jobId ? { provider: "greenhouse", slug, jobId } : null;
    }
    const ghJid = String(parsed.searchParams.get("gh_jid") || "").trim();
    if (segments[0] && ghJid) {
      return { provider: "greenhouse", slug: segments[0], jobId: ghJid };
    }
    return null;
  }

  if (host === "jobs.lever.co" && segments.length >= 2) {
    return { provider: "lever", slug: segments[0], jobId: segments[1] };
  }

  if (host === "jobs.ashbyhq.com" && segments.length >= 2) {
    return { provider: "ashby", slug: segments[0], jobId: segments[1] };
  }

  if (
    (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") &&
    segments.length >= 2
  ) {
    const slug = segments[0];
    const rawId = segments[1] || "";
    const numeric = rawId.match(/^(\d{6,})/);
    const jobId = numeric ? numeric[1] : rawId;
    return slug && jobId ? { provider: "smartrecruiters", slug, jobId } : null;
  }

  if (/\.(?:myworkdayjobs|workdayjobs)\.com$/i.test(host) && segments.includes("job")) {
    const locale = /^[a-z]{2}-[A-Z]{2}$/.test(segments[0] || "") ? segments[0] : "";
    const site = locale ? segments[1] : segments[0];
    const jobIndex = segments.indexOf("job");
    const jobPath = "/" + segments.slice(jobIndex).join("/");
    const tenant = host.split(".")[0];
    if (site && jobPath.length > 5 && tenant) {
      return {
        provider: "workday",
        tenant,
        site,
        jobPath,
        origin: parsed.origin,
      };
    }
  }

  if (host === "apply.workable.com" && segments.length >= 3 && segments[1] === "j") {
    return { provider: "workable", slug: segments[0], jobId: segments[2] };
  }

  return null;
}

/**
 * @param {string} rawUrl
 * @param {{ fetchImpl?: typeof globalThis.fetch }} [options]
 * @returns {Promise<{ title: string, company: string, location: string, description: string, provider: string, apiUrl: string } | null>}
 */
export async function fetchAtsJobPosting(rawUrl, options = {}) {
  const identity = parseAtsJobIdentity(rawUrl);
  if (!identity) return null;
  /** @type {typeof globalThis.fetch} */
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  switch (identity.provider) {
    case "greenhouse":
      return identity.slug && identity.jobId
        ? fetchGreenhouseJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "lever":
      return identity.slug && identity.jobId
        ? fetchLeverJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "ashby":
      return identity.slug && identity.jobId
        ? fetchAshbyJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "smartrecruiters":
      return identity.slug && identity.jobId
        ? fetchSmartRecruitersJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "workday":
      return identity.tenant && identity.site && identity.jobPath && identity.origin
        ? fetchWorkdayJob(
            {
              tenant: identity.tenant,
              site: identity.site,
              jobPath: identity.jobPath,
              origin: identity.origin,
            },
            fetchImpl,
          )
        : null;
    case "workable":
      return identity.slug && identity.jobId
        ? fetchWorkableJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    default:
      return null;
  }
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchGreenhouseJob(identity, fetchImpl) {
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(identity.slug)}/jobs/${encodeURIComponent(identity.jobId)}`;
  const body = await fetchJson(apiUrl, fetchImpl);
  const title = stringField(body, "title");
  const description =
    stripHtml(stringField(body, "content")) || stripHtml(stringField(body, "description"));
  if (!title || description.length < 80) return null;
  const locationObject = objectField(body, "location");
  return {
    title,
    company:
      stringField(body, "company_name") ||
      stringField(body, "company") ||
      identity.slug,
    location: locationObject ? stringField(locationObject, "name") : "",
    description,
    provider: "greenhouse",
    apiUrl,
  };
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchLeverJob(identity, fetchImpl) {
  const apiUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(identity.slug)}/${encodeURIComponent(identity.jobId)}?mode=json`;
  const body = await fetchJson(apiUrl, fetchImpl);
  const title = stringField(body, "text") || stringField(body, "title");
  const description =
    stripHtml(stringField(body, "descriptionPlain")) ||
    stripHtml(stringField(body, "description"));
  if (!title || description.length < 80) return null;
  const categories = objectField(body, "categories");
  return {
    title,
    company: stringField(body, "company") || stringField(body, "organization") || identity.slug,
    location: categories ? stringField(categories, "location") : "",
    description,
    provider: "lever",
    apiUrl,
  };
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchAshbyJob(identity, fetchImpl) {
  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(identity.slug)}`;
  const body = await fetchJson(apiUrl, fetchImpl);
  const jobs = body && Array.isArray(body.jobs) ? body.jobs : [];
  const matched = jobs.find(
    (row) =>
      row &&
      typeof row === "object" &&
      String(/** @type {Record<string, unknown>} */ (row).id || "") === identity.jobId,
  );
  if (!matched || typeof matched !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (matched);
  const title = stringField(record, "title");
  const description =
    stripHtml(stringField(record, "descriptionPlain")) ||
    stripHtml(stringField(record, "descriptionHtml")) ||
    stripHtml(stringField(record, "description"));
  if (!title || description.length < 80) return null;
  const locationValue = record.location;
  const location =
    typeof locationValue === "string"
      ? locationValue.trim()
      : locationValue && typeof locationValue === "object" && !Array.isArray(locationValue)
        ? stringField(/** @type {Record<string, unknown>} */ (locationValue), "name")
        : "";
  return {
    title,
    company:
      stringField(record, "companyName") ||
      stringField(record, "organizationName") ||
      identity.slug,
    location,
    description,
    provider: "ashby",
    apiUrl,
  };
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchSmartRecruitersJob(identity, fetchImpl) {
  const apiUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(identity.slug)}/postings/${encodeURIComponent(identity.jobId)}`;
  const body = await fetchJson(apiUrl, fetchImpl);
  const title = stringField(body, "name") || stringField(body, "title");
  const jobAd = objectField(body, "jobAd");
  const sections = jobAd ? objectField(jobAd, "sections") : null;
  const description = [
    sectionText(sections, "jobDescription"),
    sectionText(sections, "qualifications"),
    sectionText(sections, "additionalInformation"),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!title || description.length < 80) return null;
  const companyObject = objectField(body, "company");
  const locationObject = objectField(body, "location");
  return {
    title,
    company: companyObject ? stringField(companyObject, "name") : identity.slug,
    location: locationObject
      ? [stringField(locationObject, "city"), stringField(locationObject, "region")]
          .filter(Boolean)
          .join(", ")
      : "",
    description,
    provider: "smartrecruiters",
    apiUrl,
  };
}

/**
 * @param {{ tenant: string, site: string, jobPath: string, origin: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchWorkdayJob(identity, fetchImpl) {
  const apiUrl = `${identity.origin}/wday/cxs/${encodeURIComponent(identity.tenant)}/${encodeURIComponent(identity.site)}${identity.jobPath}`;
  const body = await fetchJson(apiUrl, fetchImpl);
  const info = objectField(body, "jobPostingInfo") || body;
  const title = stringField(info, "title");
  const description = stripHtml(
    stringField(info, "jobDescription") || stringField(info, "description"),
  );
  if (!title || description.length < 80) return null;
  return {
    title,
    company: identity.tenant,
    location: stringField(info, "location"),
    description,
    provider: "workday",
    apiUrl,
  };
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchWorkableJob(identity, fetchImpl) {
  const candidates = [
    `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(identity.slug)}/jobs/${encodeURIComponent(identity.jobId)}`,
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(identity.slug)}/jobs/${encodeURIComponent(identity.jobId)}`,
  ];
  for (const apiUrl of candidates) {
    const body = await fetchJson(apiUrl, fetchImpl);
    if (!body) continue;
    const title = stringField(body, "title") || stringField(body, "name");
    const description =
      stripHtml(stringField(body, "description")) ||
      stripHtml(stringField(body, "full_description")) ||
      stripHtml(stringField(body, "summary"));
    if (!title || description.length < 80) continue;
    const location = objectField(body, "location");
    return {
      title,
      company: identity.slug,
      location: location
        ? [stringField(location, "city"), stringField(location, "country")].filter(Boolean).join(", ")
        : "",
      description,
      provider: "workable",
      apiUrl,
    };
  }
  return null;
}

/**
 * @param {string} url
 * @param {typeof globalThis.fetch} fetchImpl
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function fetchJson(url, fetchImpl) {
  const target = validateScrapeTarget(url);
  if (!target.ok) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATS_TIMEOUT_MS);
  try {
    const response = await safeFetch(
      target.url,
      {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        },
      },
      { fetchImpl },
    );
    if (!response || !response.ok) return null;
    if (typeof response.json !== "function") return null;
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return /** @type {Record<string, unknown>} */ (body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** @param {unknown} html */
function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  // Greenhouse (and some Workday payloads) entity-encode the HTML. Decode
  // first or tag stripping never sees a real "<".
  const decoded = html
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** @param {Record<string, unknown> | null} record @param {string} key */
function stringField(record, key) {
  if (!record) return "";
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

/** @param {Record<string, unknown> | null} record @param {string} key */
function objectField(record, key) {
  if (!record) return null;
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string, unknown> | null} sections @param {string} key */
function sectionText(sections, key) {
  const section = objectField(sections, key);
  return section ? stripHtml(stringField(section, "text")) : "";
}

/** @param {string} value */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
