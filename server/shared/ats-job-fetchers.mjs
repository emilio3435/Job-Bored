/**
 * Public ATS JSON/XML fetchers for a single job URL.
 * These endpoints do not need API keys. Used by the Cheerio scraper before
 * it trusts hosted HTML, which is often an SPA shell or a careers listing.
 */
import * as cheerio from "cheerio";
import { validateScrapeTarget, safeFetch } from "../security-boundaries.mjs";
import { htmlToText } from "./text-normalize.mjs";

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

  if (/\.recruitee\.com$/i.test(host) && segments[0] === "o" && segments[1]) {
    return { provider: "recruitee", slug: host.split(".")[0], jobId: segments[1] };
  }

  if (/\.teamtailor\.com$/i.test(host) && segments[0] === "jobs" && segments[1]) {
    return { provider: "teamtailor", slug: host.split(".")[0], jobId: segments[1] };
  }

  if (/\.jobs\.personio\.(?:de|com)$/i.test(host) && segments[0] === "job" && segments[1]) {
    return {
      provider: "personio",
      slug: host.split(".")[0],
      jobId: segments[1],
      origin: parsed.origin,
    };
  }

  if (/\.pinpointhq\.com$/i.test(host)) {
    const postingIndex = segments.indexOf("postings");
    const jobId = postingIndex >= 0 ? segments[postingIndex + 1] : "";
    if (jobId) {
      return { provider: "pinpoint", slug: host.split(".")[0], jobId };
    }
  }

  if (host === "ats.rippling.com") {
    const jobsIndex = segments.indexOf("jobs");
    const jobId = jobsIndex >= 0 ? segments[jobsIndex + 1] || "" : "";
    const localePrefixed =
      jobsIndex === 2 && /^[a-z]{2}-[A-Z]{2}$/.test(segments[0] || "");
    const slug = localePrefixed ? segments[1] : jobsIndex === 1 ? segments[0] : "";
    if (slug && jobId) {
      return { provider: "rippling", slug, jobId };
    }
  }

  if (
    /\.bamboohr\.com$/i.test(host) &&
    segments[0] === "careers" &&
    segments[1] &&
    segments[1] !== "list"
  ) {
    return { provider: "bamboohr", slug: host.split(".")[0], jobId: segments[1] };
  }

  if (/\.applytojob\.com$/i.test(host) && segments[0] === "apply" && segments[1]) {
    return { provider: "jazzhr", slug: host.split(".")[0], jobId: segments[1] };
  }

  if (host === "jobs.gem.com" && segments.length >= 2) {
    return { provider: "gem", slug: segments[0], jobId: segments[1] };
  }

  if (host === "app.dover.com" || host === "app.dover.io") {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const queryJob = ["id", "job", "jobId", "job_id", "gh_jid"]
      .map((key) => String(parsed.searchParams.get(key) || "").trim())
      .find((value) => uuidRe.test(value));
    const pathJob = [...segments].reverse().find((part) => uuidRe.test(part));
    const jobId = (pathJob || queryJob || "").toLowerCase();
    const root = segments[0] || "";
    if (!jobId || (root && root !== "apply" && root !== "jobs")) return null;
    if (!root && !queryJob) return null;
    const slugCandidate =
      segments[1] && !uuidRe.test(segments[1]) ? segments[1] : "";
    return slugCandidate
      ? { provider: "dover", slug: slugCandidate, jobId }
      : { provider: "dover", jobId };
  }

  if (/\.homerun\.co$/i.test(host)) {
    const slug = host.split(".")[0] || "";
    if (["www", "404", "feed", "api", "static", "cdn"].includes(slug)) return null;
    const jobId = segments[0] || "";
    if (!slug || !jobId || jobId === "apply") return null;
    return { provider: "homerun", slug, jobId };
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
  /** @type {typeof globalThis.fetch} */
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!identity) {
    return fetchGenericCareerFeed(rawUrl, fetchImpl);
  }
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
    case "recruitee":
      return identity.slug && identity.jobId
        ? fetchRecruiteeJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "teamtailor":
      return identity.slug && identity.jobId
        ? fetchTeamtailorJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "personio":
      return identity.jobId && identity.origin
        ? fetchPersonioJob(
            { slug: identity.slug || "", jobId: identity.jobId, origin: identity.origin },
            fetchImpl,
          )
        : null;
    case "pinpoint":
      return identity.slug && identity.jobId
        ? fetchPinpointJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "rippling":
      return identity.slug && identity.jobId
        ? fetchRipplingJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "bamboohr":
      return identity.slug && identity.jobId
        ? fetchBambooHrJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "jazzhr":
      return identity.slug && identity.jobId
        ? fetchJazzHrJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "gem":
      return identity.slug && identity.jobId
        ? fetchGemJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    case "dover":
      return identity.jobId ? fetchDoverJob({ jobId: identity.jobId }, fetchImpl) : null;
    case "homerun":
      return identity.slug && identity.jobId
        ? fetchHomerunJob({ slug: identity.slug, jobId: identity.jobId }, fetchImpl)
        : null;
    default:
      return fetchGenericCareerFeed(rawUrl, fetchImpl);
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
    `https://apply.workable.com/api/v2/accounts/${encodeURIComponent(identity.slug)}/jobs/${encodeURIComponent(identity.jobId)}`,
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
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchRecruiteeJob(identity, fetchImpl) {
  const singleUrl = `https://${encodeURIComponent(identity.slug)}.recruitee.com/api/offers/${encodeURIComponent(identity.jobId)}`;
  const single = await fetchJson(singleUrl, fetchImpl);
  const singleOffer = single ? objectField(single, "offer") || single : null;
  if (singleOffer && recruiteeMatches(singleOffer, identity.jobId)) {
    const posting = postingFromRecruitee(singleOffer, identity.slug, singleUrl);
    if (posting) return posting;
  }

  const listUrl = `https://${encodeURIComponent(identity.slug)}.recruitee.com/api/offers/`;
  const list = await fetchJson(listUrl, fetchImpl);
  const offers = list && Array.isArray(list.offers) ? list.offers : [];
  const matched = offers.find(
    (row) => row && typeof row === "object" && recruiteeMatches(/** @type {Record<string, unknown>} */ (row), identity.jobId),
  );
  if (!matched || typeof matched !== "object") return null;
  return postingFromRecruitee(/** @type {Record<string, unknown>} */ (matched), identity.slug, listUrl);
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} jobId
 */
function recruiteeMatches(record, jobId) {
  const id = String(jobId);
  if (stringField(record, "slug") === id) return true;
  if (String(record.id ?? "") === id) return true;
  if (stringField(record, "guid") === id) return true;
  const url = stringField(record, "careers_url") || stringField(record, "careers_apply_url");
  return url.includes(`/o/${id}`);
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} slug
 * @param {string} apiUrl
 */
function postingFromRecruitee(record, slug, apiUrl) {
  const title = stringField(record, "title") || stringField(record, "name");
  const translated = translationsText(objectField(record, "translations"));
  const description =
    stripHtml(stringField(record, "description")) ||
    stripHtml(stringField(translated, "description"));
  const requirements = stripHtml(stringField(record, "requirements"));
  const combined = [description, requirements].filter(Boolean).join("\n\n");
  if (!title || combined.length < 80) return null;
  const location = [stringField(record, "city"), stringField(record, "country")].filter(Boolean).join(", ");
  return {
    title,
    company: stringField(record, "company_name") || slug,
    location,
    description: combined,
    provider: "recruitee",
    apiUrl,
  };
}

/**
 * Recruitee translations is `{ en: { description, requirements }, ... }`.
 * Prefer English, else the first object with a description.
 * @param {Record<string, unknown> | null} translations
 * @returns {Record<string, unknown> | null}
 */
function translationsText(translations) {
  if (!translations) return null;
  const english = objectField(translations, "en");
  if (english && stringField(english, "description")) return english;
  for (const value of Object.values(translations)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = /** @type {Record<string, unknown>} */ (value);
      if (stringField(record, "description")) return record;
    }
  }
  return null;
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchTeamtailorJob(identity, fetchImpl) {
  const apiUrl = `https://${encodeURIComponent(identity.slug)}.teamtailor.com/jobs.json`;
  const body = await fetchJson(apiUrl, fetchImpl);
  const items = body && Array.isArray(body.items) ? body.items : body && Array.isArray(body.jobs) ? body.jobs : [];
  const matched = items.find(
    (row) => row && typeof row === "object" && teamtailorMatches(/** @type {Record<string, unknown>} */ (row), identity.jobId),
  );
  if (!matched || typeof matched !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (matched);
  const posting = objectField(record, "_jobposting");
  const title = stringField(record, "title") || (posting ? stringField(posting, "title") : "");
  const description =
    stripHtml(stringField(record, "content_html")) ||
    stripHtml(stringField(record, "content_text")) ||
    (posting ? stripHtml(stringField(posting, "description")) : "");
  if (!title || description.length < 80) return null;
  return {
    title,
    company: body ? stringField(body, "title") || identity.slug : identity.slug,
    location: teamtailorLocation(posting),
    description,
    provider: "teamtailor",
    apiUrl,
  };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} jobId
 */
function teamtailorMatches(record, jobId) {
  const id = String(jobId);
  if (stringField(record, "id") === id) return true;
  const url = stringField(record, "url");
  if (url.includes(`/jobs/${id}`)) return true;
  const numeric = id.match(/^(\d{3,})/);
  return Boolean(numeric && url.includes(`/jobs/${numeric[1]}`));
}

/** @param {Record<string, unknown> | null} posting */
function teamtailorLocation(posting) {
  if (!posting) return "";
  const raw = posting.jobLocation;
  const location = Array.isArray(raw)
    ? raw.find((row) => row && typeof row === "object")
    : objectField(posting, "jobLocation");
  if (!location || typeof location !== "object" || Array.isArray(location)) {
    return typeof raw === "string" ? raw.trim() : "";
  }
  const record = /** @type {Record<string, unknown>} */ (location);
  const address = objectField(record, "address");
  if (address) {
    return [stringField(address, "addressLocality"), stringField(address, "addressRegion"), stringField(address, "addressCountry")]
      .filter(Boolean)
      .join(", ");
  }
  return stringField(record, "name");
}

/**
 * @param {{ slug: string, jobId: string, origin: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchPersonioJob(identity, fetchImpl) {
  const candidates = [`${identity.origin}/xml?language=en`, `${identity.origin}/xml`];
  for (const apiUrl of candidates) {
    const xml = await fetchText(apiUrl, fetchImpl);
    if (!xml) continue;
    const posting = postingFromPersonioXml(xml, identity.jobId, identity.slug, apiUrl);
    if (posting) return posting;
  }
  return null;
}

/**
 * @param {string} xml
 * @param {string} jobId
 * @param {string} slug
 * @param {string} apiUrl
 */
function postingFromPersonioXml(xml, jobId, slug, apiUrl) {
  const $ = cheerio.load(xml, { xml: true });
  let matched = null;
  $("position").each((_, el) => {
    if ($(el).children("id").first().text().trim() === String(jobId)) {
      matched = el;
    }
  });
  if (!matched) return null;
  const node = /** @type {import("domhandler").AnyNode} */ (matched);
  const title = $(node).children("name").first().text().trim();
  const company = $(node).children("subcompany").first().text().trim() || slug;
  const location = $(node).children("office").first().text().trim();
  /** @type {string[]} */
  const parts = [];
  $(node)
    .find("jobDescription")
    .each((_, el) => {
      const heading = $(el).children("name").first().text().trim();
      const value = stripHtml($(el).children("value").first().text());
      if (heading && value) parts.push(`${heading}\n${value}`);
      else if (value) parts.push(value);
    });
  const description = parts.join("\n\n");
  if (!title || description.length < 80) return null;
  return {
    title,
    company,
    location,
    description,
    provider: "personio",
    apiUrl,
  };
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchPinpointJob(identity, fetchImpl) {
  const apiUrl = `https://${encodeURIComponent(identity.slug)}.pinpointhq.com/postings.json`;
  const body = await fetchJson(apiUrl, fetchImpl);
  const rows = body && Array.isArray(body.data) ? body.data : [];
  const matched = rows.find(
    (row) => row && typeof row === "object" && pinpointMatches(/** @type {Record<string, unknown>} */ (row), identity.jobId),
  );
  if (!matched || typeof matched !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (matched);
  const title = stringField(record, "title");
  const description = [
    stripHtml(stringField(record, "description")),
    stripHtml(stringField(record, "key_responsibilities")),
    stripHtml(stringField(record, "skills_knowledge_expertise")),
    stripHtml(stringField(record, "benefits")),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!title || description.length < 80) return null;
  const location = objectField(record, "location");
  return {
    title,
    company: identity.slug,
    location: location
      ? [stringField(location, "name"), stringField(location, "city")].filter(Boolean).join(", ")
      : "",
    description,
    provider: "pinpoint",
    apiUrl,
  };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} jobId
 */
function pinpointMatches(record, jobId) {
  const id = String(jobId);
  if (String(record.id ?? "") === id) return true;
  const url = stringField(record, "url");
  const path = stringField(record, "path");
  return url.includes(`/postings/${id}`) || path.includes(`/postings/${id}`);
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchRipplingJob(identity, fetchImpl) {
  const candidates = [
    `https://ats.rippling.com/api/v2/board/${encodeURIComponent(identity.slug)}/jobs/${encodeURIComponent(identity.jobId)}`,
    `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(identity.slug)}/jobs/${encodeURIComponent(identity.jobId)}`,
  ];
  for (const apiUrl of candidates) {
    const body = await fetchJson(apiUrl, fetchImpl);
    if (!body) continue;
    const title = stringField(body, "name") || stringField(body, "title");
    const desc = objectField(body, "description");
    const description = [
      desc ? stripHtml(stringField(desc, "role")) : "",
      desc ? stripHtml(stringField(desc, "company")) : "",
      stripHtml(stringField(body, "description")),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!title || description.length < 80) continue;
    return {
      title,
      company: stringField(body, "companyName") || identity.slug,
      location: ripplingLocation(body),
      description,
      provider: "rippling",
      apiUrl,
    };
  }
  return null;
}

/** @param {Record<string, unknown>} body */
function ripplingLocation(body) {
  const workLocations = Array.isArray(body.workLocations) ? body.workLocations : [];
  const locations = Array.isArray(body.locations) ? body.locations : workLocations;
  const first = locations.find((row) => typeof row === "string" || (row && typeof row === "object"));
  if (typeof first === "string") return first.trim();
  if (first && typeof first === "object") {
    const record = /** @type {Record<string, unknown>} */ (first);
    return (
      stringField(record, "name") ||
      [stringField(record, "city"), stringField(record, "state")].filter(Boolean).join(", ")
    );
  }
  const workLocation = objectField(body, "workLocation");
  return workLocation
    ? stringField(workLocation, "label") || stringField(workLocation, "name")
    : "";
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchBambooHrJob(identity, fetchImpl) {
  const apiUrl = `https://${encodeURIComponent(identity.slug)}.bamboohr.com/careers/${encodeURIComponent(identity.jobId)}/detail`;
  const body = await fetchJson(apiUrl, fetchImpl);
  const result = body ? objectField(body, "result") : null;
  const opening = result ? objectField(result, "jobOpening") : body ? objectField(body, "jobOpening") : null;
  if (!opening) return null;
  const title = stringField(opening, "jobOpeningName") || stringField(opening, "title");
  const description = stripHtml(stringField(opening, "description"));
  if (!title || description.length < 80) return null;
  const location = objectField(opening, "location");
  return {
    title,
    company: identity.slug,
    location: location
      ? [stringField(location, "city"), stringField(location, "state")].filter(Boolean).join(", ")
      : "",
    description,
    provider: "bamboohr",
    apiUrl,
  };
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchJazzHrJob(identity, fetchImpl) {
  const apiUrl = `https://app.jazz.co/feeds/export/jobs/${encodeURIComponent(identity.slug)}`;
  const xml = await fetchText(apiUrl, fetchImpl);
  if (!xml) return null;
  const $ = cheerio.load(xml, { xml: true });
  let matched = null;
  $("job").each((_, el) => {
    const url = $(el).children("url").first().text().trim();
    if (url.includes(`/apply/${identity.jobId}`)) {
      matched = el;
    }
  });
  if (!matched) return null;
  const node = /** @type {import("domhandler").AnyNode} */ (matched);
  const title = $(node).children("title").first().text().trim();
  const description = stripHtml($(node).children("description").first().text());
  if (!title || description.length < 80) return null;
  return {
    title,
    company: identity.slug,
    location: [$(node).children("city").first().text().trim(), $(node).children("state").first().text().trim()]
      .filter(Boolean)
      .join(", "),
    description,
    provider: "jazzhr",
    apiUrl,
  };
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchGemJob(identity, fetchImpl) {
  const apiUrl = `https://api.gem.com/job_board/v0/${encodeURIComponent(identity.slug)}/job_posts/`;
  const body = await fetchJsonValue(apiUrl, fetchImpl);
  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray(/** @type {Record<string, unknown>} */ (body).job_posts)
      ? /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (body).job_posts)
      : [];
  const matched = rows.find(
    (row) => row && typeof row === "object" && gemMatches(/** @type {Record<string, unknown>} */ (row), identity.jobId),
  );
  if (!matched || typeof matched !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (matched);
  const title = stringField(record, "title");
  const description =
    stripHtml(stringField(record, "content_plain")) || stripHtml(stringField(record, "content"));
  if (!title || description.length < 80) return null;
  const location = objectField(record, "location");
  return {
    title,
    company: identity.slug,
    location: location ? stringField(location, "name") : "",
    description,
    provider: "gem",
    apiUrl,
  };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} jobId
 */
function gemMatches(record, jobId) {
  const id = String(jobId);
  if (String(record.id ?? "") === id) return true;
  return stringField(record, "absolute_url").includes(`/${id}`);
}

/**
 * @param {{ jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchDoverJob(identity, fetchImpl) {
  const candidates = [
    `https://app.dover.com/api/v1/inbound/application-portal-job/${encodeURIComponent(identity.jobId)}`,
    `https://app.dover.com/api/v1/job-board/jobs/${encodeURIComponent(identity.jobId)}/`,
  ];
  for (const apiUrl of candidates) {
    const body = await fetchJson(apiUrl, fetchImpl);
    if (!body) continue;
    const title = stringField(body, "title");
    const description =
      stripHtml(stringField(body, "user_provided_description")) ||
      stripHtml(stringField(body, "user_facing_description"));
    if (!title || description.length < 80) continue;
    const client = objectField(body, "client");
    return {
      title,
      company:
        stringField(body, "client_name") ||
        (client ? stringField(client, "name") : "") ||
        stringField(body, "company"),
      location: doverLocation(body),
      description,
      provider: "dover",
      apiUrl,
    };
  }
  return null;
}

/** @param {Record<string, unknown>} body */
function doverLocation(body) {
  const locations = Array.isArray(body.locations) ? body.locations : [];
  const first = locations.find((row) => row && typeof row === "object");
  if (first && typeof first === "object") {
    const record = /** @type {Record<string, unknown>} */ (first);
    const option = objectField(record, "location_option");
    const named =
      stringField(record, "name") ||
      (option ? stringField(option, "display_name") : "");
    if (named) return named;
  }
  return stringField(body, "workplace_type");
}

/**
 * @param {{ slug: string, jobId: string }} identity
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchHomerunJob(identity, fetchImpl) {
  const apiUrl = `https://feed.homerun.co/${encodeURIComponent(identity.slug)}`;
  const xml = await fetchText(apiUrl, fetchImpl);
  if (!xml) return null;
  return postingFromHomerunXml(xml, identity.jobId, identity.slug, apiUrl);
}

/**
 * @param {string} xml
 * @param {string} jobId
 * @param {string} slug
 * @param {string} apiUrl
 */
function postingFromHomerunXml(xml, jobId, slug, apiUrl) {
  const $ = cheerio.load(xml.replace(/\sxmlns(?::[a-zA-Z0-9]+)?="[^"]*"/g, ""), {
    xml: true,
  });
  /** @type {import("domhandler").AnyNode | null} */
  let matched = null;
  $("entry").each((_, el) => {
    if (matched) return;
    const href = $(el).children("link").first().attr("href") || "";
    const id = $(el).children("id").first().text().trim();
    if (homerunMatches(href, id, jobId)) matched = el;
  });
  if (!matched) return null;
  const node = matched;
  const title = $(node).children("title").first().text().trim();
  const description =
    stripHtml($(node).children("description").first().text()) ||
    stripHtml($(node).children("content").first().text());
  if (!title || description.length < 80) return null;
  const company =
    $(node).find("author > name").first().text().trim() ||
    $("feed > title").first().text().trim() ||
    slug;
  const location = $(node).find("location > name").first().text().trim();
  return {
    title,
    company,
    location,
    description,
    provider: "homerun",
    apiUrl,
  };
}

/**
 * @param {string} href
 * @param {string} entryId
 * @param {string} jobId
 */
function homerunMatches(href, entryId, jobId) {
  const id = String(jobId);
  if (entryId && entryId === id) return true;
  try {
    const parsed = new URL(href);
    const first = parsed.pathname.split("/").filter(Boolean)[0] || "";
    return first === id;
  } catch {
    return href.includes(`/${id}`);
  }
}

/**
 * Same-origin public feeds used by Teamtailor custom domains, Recruitee
 * custom domains, Pinpoint clones, and any JSON Feed 1.1 career site.
 * This is how unknown boards keep working without a new fetcher.
 * @param {string} rawUrl
 * @param {typeof globalThis.fetch} fetchImpl
 */
async function fetchGenericCareerFeed(rawUrl, fetchImpl) {
  if (!looksLikeCareerJobUrl(rawUrl)) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const origin = parsed.origin;
  const candidates = [
    `${origin}/jobs.json`,
    `${origin}/postings.json`,
    `${origin}/api/offers/`,
    `${origin}/api/offers`,
  ];
  const payloads = await Promise.all(candidates.map((url) => fetchJsonValue(url, fetchImpl)));
  for (let i = 0; i < payloads.length; i++) {
    const posting = postingFromCareerFeed(payloads[i], rawUrl, candidates[i]);
    if (posting) return posting;
  }
  return null;
}

/** @param {string} rawUrl */
function looksLikeCareerJobUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (
    /(^|\.)(linkedin|indeed|glassdoor|google|facebook|twitter|x|ziprecruiter|monster)\.com$/i.test(
      host,
    )
  ) {
    return false;
  }
  return /\/(jobs?|careers|apply|postings|openings|positions|o|p|j)(?:\/|$)/i.test(
    parsed.pathname,
  );
}

/**
 * @param {unknown} payload
 * @param {string} jobUrl
 * @param {string} apiUrl
 */
function postingFromCareerFeed(payload, jobUrl, apiUrl) {
  if (!payload) return null;
  let feedTitle = "";
  /** @type {unknown[]} */
  let rows = [];
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (typeof payload === "object") {
    const record = /** @type {Record<string, unknown>} */ (payload);
    feedTitle = stringField(record, "title") || stringField(record, "name");
    if (Array.isArray(record.items)) rows = record.items;
    else if (Array.isArray(record.offers)) rows = record.offers;
    else if (Array.isArray(record.data)) rows = record.data;
    else if (Array.isArray(record.jobs)) rows = record.jobs;
    else if (Array.isArray(record.positions)) rows = record.positions;
    else if (record.offer && typeof record.offer === "object") rows = [record.offer];
  }
  const matched = rows.find(
    (row) => row && typeof row === "object" && careerFeedMatches(/** @type {Record<string, unknown>} */ (row), jobUrl),
  );
  if (!matched || typeof matched !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (matched);
  const posting = objectField(record, "_jobposting");
  const title =
    stringField(record, "title") ||
    stringField(record, "name") ||
    (posting ? stringField(posting, "title") : "");
  const description =
    stripHtml(stringField(record, "content_html")) ||
    stripHtml(stringField(record, "content_text")) ||
    stripHtml(stringField(record, "content_plain")) ||
    stripHtml(stringField(record, "description")) ||
    stripHtml(stringField(record, "descriptionHtml")) ||
    stripHtml(stringField(record, "descriptionPlain")) ||
    stripHtml(stringField(record, "content")) ||
    (posting ? stripHtml(stringField(posting, "description")) : "");
  if (!title || description.length < 80) return null;
  const locationObject = objectField(record, "location");
  return {
    title,
    company: stringField(record, "company_name") || stringField(record, "companyName") || feedTitle,
    location: locationObject
      ? stringField(locationObject, "name") || stringField(locationObject, "city")
      : stringField(record, "city"),
    description,
    provider: "career-feed",
    apiUrl,
  };
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} jobUrl
 */
function careerFeedMatches(record, jobUrl) {
  let parsed;
  try {
    parsed = new URL(jobUrl);
  } catch {
    return false;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  const last = path.split("/").filter(Boolean).pop() || "";
  const candidates = [
    stringField(record, "url"),
    stringField(record, "careers_url"),
    stringField(record, "absolute_url"),
    stringField(record, "path"),
    stringField(record, "slug"),
    String(record.id ?? ""),
  ];
  if (candidates.some((value) => value && (value.includes(path) || value === last))) return true;
  const numeric = last.match(/^(\d{3,})/);
  return Boolean(numeric && candidates.some((value) => value.includes(`/jobs/${numeric[1]}`)));
}

/**
 * @param {string} url
 * @param {typeof globalThis.fetch} fetchImpl
 * @returns {Promise<string>}
 */
async function fetchText(url, fetchImpl) {
  const target = validateScrapeTarget(url);
  if (!target.ok) return "";
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
          Accept: "application/xml, text/xml, text/plain;q=0.9, */*;q=0.8",
        },
      },
      { fetchImpl },
    );
    if (!response || !response.ok) return "";
    if (typeof response.arrayBuffer === "function") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return new TextDecoder("utf-8").decode(bytes);
    }
    if (typeof response.text === "function") {
      return String(await response.text());
    }
    return "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {typeof globalThis.fetch} fetchImpl
 * @returns {Promise<Record<string, unknown> | unknown[] | null>}
 */
async function fetchJsonValue(url, fetchImpl) {
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
    if (!body || typeof body !== "object") return null;
    return /** @type {Record<string, unknown> | unknown[]} */ (body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {typeof globalThis.fetch} fetchImpl
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function fetchJson(url, fetchImpl) {
  const body = await fetchJsonValue(url, fetchImpl);
  if (!body || Array.isArray(body)) return null;
  return body;
}

/** @param {unknown} html */
function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return htmlToText(html);
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
