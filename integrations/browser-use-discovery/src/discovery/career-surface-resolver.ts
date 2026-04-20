import { URL } from "node:url";

import type {
  AtsSourceId,
  CareerSurfaceType,
  CompanyTarget,
  DiscoverySourceLane,
} from "../contracts.ts";

type HostnameRule = string | RegExp;

export type CareerSurfaceSourcePolicy =
  | "blocked"
  | "hint_only"
  | "extractable";

export type CareerSurfacePageType =
  | "job"
  | "listings"
  | "careers"
  | "other";

export type CareerSurfaceCandidate = {
  url: string;
  title: string;
  pageType: CareerSurfacePageType;
  reason: string;
  sourceDomain: string;
  sourcePolicy?: CareerSurfaceSourcePolicy;
  resolvedFromUrl?: string;
  finalUrl?: string;
  preflightStatus?: "passed" | "rejected";
  preflightReason?: string;
  providerType?: AtsSourceId;
  surfaceType?: CareerSurfaceType;
  canonicalUrl?: string;
  boardToken?: string;
  sourceLane?: DiscoverySourceLane;
  detectionSignals?: string[];
};

export type CareerSurfaceHtmlDetection = {
  candidates: CareerSurfaceCandidate[];
  signals: string[];
};

const BLOCKED_HOSTS: HostnameRule[] = [
  "support.google.com",
  "accounts.google.com",
  "maps.google.com",
  "docs.google.com",
  "googleusercontent.com",
  "gstatic.com",
  "licdn.com",
];

const THIRD_PARTY_JOB_BOARD_HOSTS: HostnameRule[] = [
  "linkedin.com",
  "glassdoor.com",
  "indeed.com",
  "monster.com",
  "ziprecruiter.com",
  "careerbuilder.com",
  "simplyhired.com",
  "simplyhired.co.uk",
  "builtin.com",
  "wellfound.com",
  "otta.com",
  "workingnomads.com",
  "remoteok.com",
  "remote.co",
  "weworkremotely.com",
  "remotive.io",
  "dynamitejobs.com",
  "jobspresso.co",
  "jobgether.com",
  "himalayas.app",
  "flexjobs.com",
  "powertofly.com",
  "jooble.org",
  "talent.com",
  "dice.com",
  "snagajob.com",
  "jobtoday.com",
  "jobisjob.com",
  "careerjet.com",
  "jobrapido.com",
  "adzuna.com",
  "angel.co",
  // Layer 3 additions — aggregators Gemini cited that reliably 404 or mask
  // first-party URLs behind interstitials. Treating as hint_only forces
  // canonical resolution before extraction.
  "jobtarget.com",
  "hireology.com",
  "jobot.com",
  "jobleads.com",
  "lensa.com",
  "workfromhome.ng",
  "instituteofdata.jobs",
];

const FIRST_PARTY_PATH_PATTERN =
  /\/(?:careers?|jobs?|join-us|work-with-us|join-our-team|work-with|open-roles?)(?:[/?#]|$)/i;
const FIRST_PARTY_SUBDOMAIN_PATTERN =
  /^(?:careers?|jobs?|join|work|apply|hiring|career)(?:[.-]|$)/i;
const DIRECT_JOB_PATH_PATTERN =
  /(\/job\/|\/jobs\/[^/?#]+|\/careers\/[^/?#]+|\/positions\/|\/openings\/|\/vacancies\/|gh_jid=|gh_src=|lever\.co\/[^/]+\/[^/?#]+|ashbyhq\.com\/[^/]+\/[^/?#]+)/i;

function matchesHostnameRule(hostname: string, rule: HostnameRule): boolean {
  return typeof rule === "string"
    ? hostname === rule || hostname.endsWith(`.${rule}`)
    : rule.test(hostname);
}

function splitPathSegments(pathname: string): string[] {
  return pathname.split("/").map((entry) => entry.trim()).filter(Boolean);
}

function cleanText(input: string): string {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function stripHtml(input: string): string {
  return String(input || "").replace(/<[^>]+>/g, " ");
}

function htmlDecode(input: string): string {
  return String(input || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map((entry) => cleanText(entry)).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function readHtmlAttribute(fragment: string, attributeName: string): string {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(fragment || "").match(
    new RegExp(`${escapedName}\\s*=\\s*["']([^"']+)["']`, "i"),
  );
  return cleanText(htmlDecode(match?.[1] || ""));
}

function extractTitleTag(html: string): string {
  const match = String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(stripHtml(htmlDecode(match?.[1] || "")));
}

function normalizeCompanyToken(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function humanizeToken(input: string): string {
  const cleaned = String(input || "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const tail = parts.slice(-2).join(".");
  const countryCodeTail = parts.slice(-3).join(".");
  if (/^(?:co|com|org|net|gov|edu)\.[a-z]{2}$/i.test(tail)) {
    return countryCodeTail;
  }
  return tail;
}

function companyIdentityTokens(company: CompanyTarget): string[] {
  const names = [
    company.name,
    company.normalizedName,
    ...(company.aliases || []),
    ...(company.domains || []),
  ];
  const out = new Set<string>();
  for (const name of names) {
    const cleaned = String(name || "").toLowerCase();
    for (const token of cleaned.split(/[^a-z0-9]+/)) {
      if (token.length >= 3) out.add(token);
    }
  }
  return [...out];
}

function companyDomainMatches(hostname: string, company: CompanyTarget): boolean {
  const companyDomains = (company.domains || [])
    .map((entry) => cleanText(entry).toLowerCase())
    .filter(Boolean);
  if (companyDomains.length > 0) {
    const root = registrableDomain(hostname);
    return companyDomains.some((entry) => {
      const normalized = entry.replace(/^https?:\/\//, "").replace(/^www\./, "");
      const entryRoot = registrableDomain(normalized);
      return hostname === normalized || hostname.endsWith(`.${normalized}`) || root === entryRoot;
    });
  }

  const tokens = companyIdentityTokens(company);
  const host = hostname.toLowerCase();
  const root = registrableDomain(host);
  return tokens.some((token) => host.includes(token) || root.includes(token));
}

function companyMentioned(haystack: string, company: CompanyTarget): boolean {
  const text = String(haystack || "").toLowerCase();
  return companyIdentityTokens(company).some((token) => text.includes(token));
}

function isGoogleJobsLikeSurface(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "google.com" && hostname !== "www.google.com") return false;
  const query = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  return /(?:\/search|\/url|\/jobs|\bibp=htl;jobs\b|\btbm=jobs\b|\budm=8\b|\bjobs?\b)/i.test(query);
}

export function canonicalizeCareerSurfaceUrl(input: string): string {
  try {
    const parsed = new URL(String(input || "").trim());
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    parsed.hash = "";
    const paramsToDrop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "lever-origin",
      "lever-via",
      "source",
      "src",
      "ref",
      "referrer",
    ];
    for (const key of [...parsed.searchParams.keys()]) {
      if (paramsToDrop.some((entry) => entry === key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function classifyCareerSurfaceSourcePolicy(url: string): CareerSurfaceSourcePolicy {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!["https:", "http:"].includes(parsed.protocol)) {
      return "blocked";
    }
    // SSRF guard: reject URLs that would let the preflight fetch hit loopback,
    // private IPv4 ranges, link-local (incl. 169.254.169.254 cloud-metadata),
    // IPv6 loopback/link-local, or embed credentials in userinfo. Previously
    // a schema-compliant Gemini response pointing at internal addresses flowed
    // straight into prepareGroundedSeedCandidates' real fetch.
    if (parsed.username || parsed.password) {
      return "blocked";
    }
    if (isPrivateOrLoopbackHost(hostname)) {
      return "blocked";
    }
    if (isGoogleJobsLikeSurface(parsed)) {
      return "hint_only";
    }
    if (hostname === "google.com" || hostname === "www.google.com") {
      return "blocked";
    }
    if (BLOCKED_HOSTS.some((rule) => matchesHostnameRule(hostname, rule))) {
      return "blocked";
    }
    if (isThirdPartyJobBoardHost(url)) {
      return "hint_only";
    }
  } catch {
    return "blocked";
  }
  return "extractable";
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  // IPv6 loopback "::1" or link-local "fe80::" come in as "[::1]" or "[fe80::...]"
  // after URL parsing, .hostname strips the brackets, so match the bare form.
  if (hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("fc") || hostname.startsWith("fd")) {
    return true;
  }
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // 127.0.0.0/8 loopback
  if (a === 0) return true;                        // 0.0.0.0/8
  if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  return false;
}

export function isThirdPartyJobBoardHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return THIRD_PARTY_JOB_BOARD_HOSTS.some((rule) => matchesHostnameRule(hostname, rule));
  } catch {
    return false;
  }
}

export function classifyCareerSurfacePageType(
  url: string,
  title: string,
): CareerSurfacePageType {
  const haystack = `${url} ${title}`.toLowerCase();
  if (DIRECT_JOB_PATH_PATTERN.test(haystack)) {
    return "job";
  }
  if (/(open roles|job board|jobs search|all jobs|join us|open positions)/i.test(haystack)) {
    return "listings";
  }
  if (/(career|careers|jobs|join us|work with us|open roles)/i.test(haystack)) {
    return "careers";
  }
  return "other";
}

function normalizePageType(value: string): CareerSurfacePageType {
  const text = String(value || "").toLowerCase();
  if (text === "job" || text === "jobs" || text === "posting") return "job";
  if (text === "listings" || text === "listing" || text === "board") return "listings";
  if (text === "careers" || text === "career") return "careers";
  return "other";
}

type InferredProviderSurface = {
  providerType: AtsSourceId;
  canonicalUrl: string;
  boardToken?: string;
  surfaceType: CareerSurfaceType;
  detectionSignals: string[];
};

function normalizePathRoot(pathname: string, depth: number): string {
  const parts = splitPathSegments(pathname).slice(0, depth);
  return parts.length > 0 ? `/${parts.join("/")}` : "";
}

function inferAtsSurface(url: string): InferredProviderSurface | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const segments = splitPathSegments(parsed.pathname);

    if (/^(boards(?:\.eu)?\.greenhouse\.io|job-boards\.greenhouse\.io)$/i.test(hostname) && segments[0]) {
      return {
        providerType: "greenhouse",
        canonicalUrl: `${parsed.origin}/${segments[0]}`,
        boardToken: segments[0],
        surfaceType: segments[1] === "jobs" && segments[2] ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:greenhouse"],
      };
    }

    if (hostname === "jobs.lever.co" && segments[0]) {
      return {
        providerType: "lever",
        canonicalUrl: `${parsed.origin}/${segments[0]}`,
        boardToken: segments[0],
        surfaceType: segments[1] ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:lever"],
      };
    }

    if (hostname === "jobs.ashbyhq.com" && segments[0]) {
      return {
        providerType: "ashby",
        canonicalUrl: `${parsed.origin}/${segments[0]}`,
        boardToken: segments[0],
        surfaceType: segments[1] ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:ashby"],
      };
    }

    if (hostname === "jobs.smartrecruiters.com" && segments[0]) {
      return {
        providerType: "smartrecruiters",
        canonicalUrl: `${parsed.origin}/${segments[0]}`,
        boardToken: segments[0],
        surfaceType: segments[1] ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:smartrecruiters"],
      };
    }

    if (hostname === "apply.workable.com" && segments[0]) {
      return {
        providerType: "workable",
        canonicalUrl: `${parsed.origin}/${segments[0]}`,
        boardToken: segments[0],
        surfaceType: segments[1] ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:workable"],
      };
    }

    if (/(\.|^)breezy\.hr$/i.test(hostname)) {
      const boardToken = hostname.split(".")[0] || segments[0] || "";
      return {
        providerType: "breezy",
        canonicalUrl: parsed.origin,
        boardToken: boardToken || undefined,
        surfaceType: segments.length > 0 ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:breezy"],
      };
    }

    if (/(\.|^)recruitee\.com$/i.test(hostname)) {
      const boardToken = hostname.split(".")[0] || segments[0] || "";
      return {
        providerType: "recruitee",
        canonicalUrl: parsed.origin,
        boardToken: boardToken || undefined,
        surfaceType: segments[0] === "o" && segments[1] ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:recruitee"],
      };
    }

    if (/(\.|^)teamtailor\.com$/i.test(hostname)) {
      return {
        providerType: "teamtailor",
        canonicalUrl: parsed.origin,
        boardToken: hostname.split(".")[0] || undefined,
        surfaceType: segments[0] === "jobs" && segments[1] ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:teamtailor"],
      };
    }

    if (/(\.|^)jobs\.personio\.(de|com)$/i.test(hostname)) {
      return {
        providerType: "personio",
        canonicalUrl: parsed.origin,
        boardToken: hostname.split(".")[0] || undefined,
        surfaceType: segments[0] === "job" && segments[1] ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:personio"],
      };
    }

    if (/(\.|^)myworkdayjobs\.com$/i.test(hostname) || /(\.|^)workdayjobs\.com$/i.test(hostname)) {
      let canonicalPath = "";
      if (segments[0] === "recruiting" && segments[1] && segments[2]) {
        canonicalPath = `/recruiting/${segments[1]}/${segments[2]}`;
      } else if (segments[0] && segments[1]) {
        canonicalPath = `/${segments[0]}/${segments[1]}`;
      } else if (segments[0]) {
        canonicalPath = `/${segments[0]}`;
      }
      return {
        providerType: "workday",
        canonicalUrl: `${parsed.origin}${canonicalPath}`,
        boardToken: canonicalPath.replace(/^\//, "") || undefined,
        surfaceType:
          segments.includes("job") || segments.includes("job_details") ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:workday"],
      };
    }

    if (/(\.|^)icims\.com$/i.test(hostname)) {
      const canonicalPath = segments[0] === "jobs" ? "/jobs" : normalizePathRoot(parsed.pathname, 1);
      return {
        providerType: "icims",
        canonicalUrl: `${parsed.origin}${canonicalPath}`,
        boardToken: hostname.split(".")[0] || undefined,
        surfaceType:
          segments[0] === "jobs" && segments[1] && /^\d+$/i.test(segments[1]) ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:icims"],
      };
    }

    if (/(\.|^)jobvite\.com$/i.test(hostname)) {
      const canonicalPath =
        segments[0] === "jobs" && segments[1]
          ? `/jobs/${segments[1]}`
          : segments[0]
            ? `/${segments[0]}`
            : "";
      return {
        providerType: "jobvite",
        canonicalUrl: `${parsed.origin}${canonicalPath}`,
        boardToken: segments[1] || hostname.split(".")[0] || undefined,
        surfaceType:
          segments.includes("job") || segments.includes("position") ? "job_posting" : "provider_board",
        detectionSignals: ["ats_host", "provider:jobvite"],
      };
    }

    if (/(\.|^)taleo\.net$/i.test(hostname)) {
      const canonicalPath =
        segments[0] === "careersection" && segments[1]
          ? `/careersection/${segments[1]}`
          : normalizePathRoot(parsed.pathname, 1);
      return {
        providerType: "taleo",
        canonicalUrl: `${parsed.origin}${canonicalPath}`,
        boardToken: segments[1] || hostname.split(".")[0] || undefined,
        surfaceType:
          parsed.searchParams.get("job") || /jobdetail/i.test(parsed.search)
            ? "job_posting"
            : "provider_board",
        detectionSignals: ["ats_host", "provider:taleo"],
      };
    }

    if (/(\.|^)successfactors\.com$/i.test(hostname)) {
      const companyParam = parsed.searchParams.get("company") || parsed.searchParams.get("companyName") || "";
      const canonical = new URL(`${parsed.origin}${normalizePathRoot(parsed.pathname, 1) || "/career"}`);
      if (companyParam) canonical.searchParams.set("company", companyParam);
      return {
        providerType: "successfactors",
        canonicalUrl: canonical.toString(),
        boardToken: companyParam || hostname.split(".")[0] || undefined,
        surfaceType:
          parsed.searchParams.get("career_ns") === "job_listing" || /job/i.test(parsed.search)
            ? "job_posting"
            : "provider_board",
        detectionSignals: ["ats_host", "provider:successfactors"],
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function isKnownAtsCareerSurface(url: string): boolean {
  return !!inferAtsSurface(url);
}

export function isLikelyThirdPartyJobHost(url: string): boolean {
  if (isKnownAtsCareerSurface(url)) return false;
  return classifyCareerSurfaceSourcePolicy(url) === "hint_only";
}

export function isEmployerCareerSurface(
  url: string,
  company: CompanyTarget,
): boolean {
  try {
    const parsed = new URL(url);
    if (classifyCareerSurfaceSourcePolicy(url) !== "extractable") {
      return false;
    }
    if (!companyDomainMatches(parsed.hostname, company)) {
      return false;
    }
    return (
      FIRST_PARTY_SUBDOMAIN_PATTERN.test(parsed.hostname) ||
      FIRST_PARTY_PATH_PATTERN.test(parsed.pathname) ||
      classifyCareerSurfacePageType(url, "") !== "other"
    );
  } catch {
    return false;
  }
}

function inferGenericSurfaceType(
  url: string,
  company: CompanyTarget,
  pageType: CareerSurfacePageType,
): CareerSurfaceType | undefined {
  if (isKnownAtsCareerSurface(url)) {
    return inferAtsSurface(url)?.surfaceType;
  }
  if (pageType === "job") return "job_posting";
  if (isEmployerCareerSurface(url, company)) {
    return pageType === "listings" ? "employer_jobs" : "employer_careers";
  }
  return undefined;
}

function candidateReason(
  url: string,
  company: CompanyTarget,
  title: string,
  fallback: string,
): string {
  if (isKnownAtsCareerSurface(url)) {
    const provider = inferAtsSurface(url)?.providerType || "ATS";
    return `Canonical ${provider} career surface`;
  }
  if (isEmployerCareerSurface(url, company)) {
    return title ? `Employer career surface: ${title}` : "Employer career surface";
  }
  return fallback;
}

export function normalizeCareerSurfaceCandidate(
  candidate: CareerSurfaceCandidate,
  company: CompanyTarget,
): CareerSurfaceCandidate {
  const finalUrl = canonicalizeCareerSurfaceUrl(candidate.finalUrl || "");
  const url =
    canonicalizeCareerSurfaceUrl(finalUrl || candidate.url) ||
    finalUrl ||
    candidate.url;
  const providerSurface = inferAtsSurface(url);
  const pageType = normalizePageType(
    candidate.pageType || classifyCareerSurfacePageType(url, candidate.title),
  );
  const sourcePolicy =
    candidate.sourcePolicy || classifyCareerSurfaceSourcePolicy(finalUrl || url);
  const canonicalUrl =
    canonicalizeCareerSurfaceUrl(candidate.canonicalUrl || providerSurface?.canonicalUrl || "") ||
    undefined;
  const surfaceType =
    candidate.surfaceType ||
    providerSurface?.surfaceType ||
    inferGenericSurfaceType(url, company, pageType);
  const hasCareerPathSignal = (() => {
    try {
      return FIRST_PARTY_PATH_PATTERN.test(new URL(url).pathname);
    } catch {
      return false;
    }
  })();
  const detectionSignals = uniqueStrings([
    ...(candidate.detectionSignals || []),
    ...(providerSurface?.detectionSignals || []),
    ...(isEmployerCareerSurface(url, company) ? ["employer_domain"] : []),
    ...(hasCareerPathSignal ? ["career_path"] : []),
  ]);

  return {
    ...candidate,
    url,
    title: cleanText(candidate.title) || url,
    reason: cleanText(candidate.reason) || candidateReason(url, company, candidate.title, "Career surface"),
    pageType,
    sourceDomain: safeHostname(url),
    sourcePolicy,
    finalUrl: finalUrl || undefined,
    providerType: candidate.providerType || providerSurface?.providerType,
    canonicalUrl,
    boardToken: candidate.boardToken || providerSurface?.boardToken,
    surfaceType,
    detectionSignals: detectionSignals.length > 0 ? detectionSignals : undefined,
  };
}

export function resolveCareerSurfaceCandidate(
  source: unknown,
  company: CompanyTarget,
  options: {
    defaultReason?: string;
    sourceLane?: DiscoverySourceLane;
    resolvedFromUrl?: string;
    detectionSignals?: string[];
  } = {},
): CareerSurfaceCandidate | null {
  const record = typeof source === "object" && source ? source as Record<string, unknown> : {};
  const rawUrl =
    cleanText(String(record.url || record.uri || record.link || record.href || ""));
  const url = canonicalizeCareerSurfaceUrl(rawUrl);
  if (!url) return null;

  const policy = classifyCareerSurfaceSourcePolicy(url);
  if (policy === "blocked") return null;

  const title = cleanText(String(record.title || record.name || "")) || url;
  const pageType = normalizePageType(
    String(record.pageType || record.type || classifyCareerSurfacePageType(url, title)),
  );
  const reason =
    cleanText(String(record.reason || record.why || "")) ||
    options.defaultReason ||
    candidateReason(url, company, title, `Career surface for ${company.name || "company"}`);

  return normalizeCareerSurfaceCandidate(
    {
      url,
      title,
      pageType,
      reason,
      sourceDomain: safeHostname(url),
      sourcePolicy: policy,
      resolvedFromUrl: options.resolvedFromUrl,
      sourceLane: options.sourceLane,
      detectionSignals: options.detectionSignals,
    },
    company,
  );
}

export function isPreflightReadyCareerSurface(
  candidate: CareerSurfaceCandidate,
  company: CompanyTarget,
): boolean {
  if (candidate.sourcePolicy !== "extractable") return false;
  if (candidate.providerType) return true;
  if (candidate.surfaceType === "job_posting") return true;
  if (isEmployerCareerSurface(candidate.url, company)) return true;
  return (
    candidate.pageType !== "other" &&
    companyMentioned(`${candidate.url} ${candidate.title}`, company)
  );
}

function extractUrlsViaRegex(text: string): string[] {
  return uniqueStrings(String(text || "").match(/https?:\/\/[^\s<>"')\]]+/gi) || []);
}

function parseJsonLoose(input: string): unknown | null {
  const text = String(input || "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  for (const candidate of [body, extractJsonObject(body), extractJsonArray(body)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue.
    }
  }
  return null;
}

function extractJsonObject(input: string): string {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  return start !== -1 && end > start ? input.slice(start, end + 1) : "";
}

function extractJsonArray(input: string): string {
  const start = input.indexOf("[");
  const end = input.lastIndexOf("]");
  return start !== -1 && end > start ? input.slice(start, end + 1) : "";
}

function flattenJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenJson(entry));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record["@graph"])) {
    return flattenJson(record["@graph"]);
  }
  return [record];
}

function collectJobSchemaUrls(html: string): string[] {
  const urls: string[] = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(html || "")))) {
    const raw = htmlDecode(match[1] || "");
    const parsed = parseJsonLoose(raw);
    for (const node of flattenJson(parsed)) {
      const type = String(node["@type"] || "");
      if (!/jobposting/i.test(type)) continue;
      urls.push(...extractUrlsViaRegex(JSON.stringify(node)));
    }
  }
  return uniqueStrings(urls);
}

function buildResolvedCandidate(
  url: string,
  company: CompanyTarget,
  input: {
    title?: string;
    reason: string;
    resolvedFromUrl?: string;
    sourceLane?: DiscoverySourceLane;
    detectionSignals?: string[];
  },
): CareerSurfaceCandidate | null {
  const candidate = resolveCareerSurfaceCandidate(
    {
      url,
      title: input.title || "",
      reason: input.reason,
    },
    company,
    {
      resolvedFromUrl: input.resolvedFromUrl,
      sourceLane: input.sourceLane,
      detectionSignals: input.detectionSignals,
    },
  );
  if (!candidate) return null;
  if (!isPreflightReadyCareerSurface(candidate, company)) return null;
  return candidate;
}

export function detectCareerSurfaceCandidatesFromHtml(input: {
  url: string;
  html: string;
  company: CompanyTarget;
  finalUrl?: string;
  sourceLane?: DiscoverySourceLane;
  title?: string;
}): CareerSurfaceHtmlDetection {
  const baseUrl = canonicalizeCareerSurfaceUrl(input.finalUrl || input.url) || input.url;
  const pageTitle = cleanText(input.title || extractTitleTag(input.html));
  const signals = new Set<string>();
  const candidates: CareerSurfaceCandidate[] = [];
  const pushCandidate = (
    url: string,
    reason: string,
    detectionSignals: string[],
    title = "",
  ) => {
    const candidate = buildResolvedCandidate(url, input.company, {
      title,
      reason,
      resolvedFromUrl: url === baseUrl ? undefined : baseUrl,
      sourceLane: input.sourceLane,
      detectionSignals,
    });
    if (!candidate) return;
    candidates.push(candidate);
    detectionSignals.forEach((entry) => signals.add(entry));
  };

  const baseCandidate = buildResolvedCandidate(baseUrl, input.company, {
    title: pageTitle,
    reason: "Verified employer or ATS page during resolver preflight",
    sourceLane: input.sourceLane,
    detectionSignals: [
      ...(isEmployerCareerSurface(baseUrl, input.company) ? ["employer_domain"] : []),
      ...(isKnownAtsCareerSurface(baseUrl) ? ["ats_host"] : []),
    ],
  });
  if (baseCandidate) {
    candidates.push(baseCandidate);
  }

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = anchorPattern.exec(String(input.html || "")))) {
    const href = anchorMatch[1] || "";
    const resolvedUrl = canonicalizeCareerSurfaceUrl(new URL(href, baseUrl).toString());
    if (!resolvedUrl) continue;
    const anchorHtml = anchorMatch[0] || "";
    const anchorTitle = uniqueStrings([
      cleanText(stripHtml(htmlDecode(anchorMatch[2] || ""))),
      readHtmlAttribute(anchorHtml, "title"),
      readHtmlAttribute(anchorHtml, "aria-label"),
    ])[0] || "";
    const resolvedPath = (() => {
      try {
        return new URL(resolvedUrl).pathname;
      } catch {
        return "";
      }
    })();
    if (
      FIRST_PARTY_PATH_PATTERN.test(resolvedPath) ||
      isKnownAtsCareerSurface(resolvedUrl) ||
      isEmployerCareerSurface(resolvedUrl, input.company)
    ) {
      pushCandidate(
        resolvedUrl,
        isKnownAtsCareerSurface(resolvedUrl)
          ? "ATS link discovered on employer domain"
          : "First-party career path discovered on employer domain",
        [
          isKnownAtsCareerSurface(resolvedUrl) ? "ats_link" : "career_path",
          ...(isEmployerCareerSurface(resolvedUrl, input.company) ? ["employer_domain"] : []),
        ],
        anchorTitle,
      );
    }
  }

  const hrefPattern = /\bhref=["']([^"']+)["']/gi;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = hrefPattern.exec(String(input.html || "")))) {
    try {
      const resolvedUrl = canonicalizeCareerSurfaceUrl(new URL(hrefMatch[1] || "", baseUrl).toString());
      if (!resolvedUrl) continue;
      if (isKnownAtsCareerSurface(resolvedUrl)) {
        pushCandidate(
          resolvedUrl,
          "Canonical ATS host discovered in page markup",
          ["ats_host", "markup_href"],
        );
      }
    } catch {
      // Ignore malformed hrefs.
    }
  }

  const sitemapPattern = /<loc>([\s\S]*?)<\/loc>/gi;
  let sitemapMatch: RegExpExecArray | null;
  while ((sitemapMatch = sitemapPattern.exec(String(input.html || "")))) {
    const url = canonicalizeCareerSurfaceUrl(htmlDecode(cleanText(sitemapMatch[1] || "")));
    if (!url) continue;
    if (FIRST_PARTY_PATH_PATTERN.test(new URL(url).pathname) || isKnownAtsCareerSurface(url)) {
      pushCandidate(
        url,
        "Sitemap surfaced a canonical career URL",
        ["sitemap"],
      );
    }
  }

  for (const url of collectJobSchemaUrls(input.html)) {
    pushCandidate(
      url,
      "Job schema exposed a direct employer or ATS job URL",
      ["job_schema"],
    );
  }

  for (const url of extractUrlsViaRegex(input.html)) {
    if (!isKnownAtsCareerSurface(url)) continue;
    pushCandidate(
      url,
      "Canonical ATS host discovered in page content",
      ["ats_host", "regex_url"],
    );
  }

  return {
    candidates: mergeCareerSurfaceCandidates(candidates, input.company),
    signals: [...signals],
  };
}

export function scoreCareerSurfaceCandidate(
  candidate: CareerSurfaceCandidate,
  company: CompanyTarget,
): number {
  const normalized = normalizeCareerSurfaceCandidate(candidate, company);
  let score = 0;
  if (normalized.pageType === "job") score += 40;
  else if (normalized.pageType === "listings") score += 30;
  else if (normalized.pageType === "careers") score += 20;
  if (DIRECT_JOB_PATH_PATTERN.test(normalized.url)) score += 12;
  if (companyMentioned(`${normalized.url} ${normalized.title}`, company)) score += 8;
  if (normalized.reason) score += 2;
  if (normalized.providerType) score += 8;
  if (normalized.sourcePolicy === "hint_only") score -= 18;
  if (isLikelyThirdPartyJobHost(normalized.url)) score -= 8;
  if (normalized.finalUrl && normalized.finalUrl !== normalized.url) score += 2;
  if (normalized.preflightStatus === "passed") score += 3;
  if (isEmployerCareerSurface(normalized.url, company)) score += 6;
  if (normalized.detectionSignals?.length) {
    score += Math.min(6, normalized.detectionSignals.length * 2);
  }
  return score;
}

export function mergeCareerSurfaceCandidates(
  candidates: CareerSurfaceCandidate[],
  company: CompanyTarget,
  limit = candidates.length || 1,
): CareerSurfaceCandidate[] {
  const byKey = new Map<string, CareerSurfaceCandidate>();
  for (const candidate of candidates) {
    const normalized = normalizeCareerSurfaceCandidate(candidate, company);
    const key =
      normalized.finalUrl ||
      normalized.canonicalUrl ||
      normalized.url;
    const existing = byKey.get(key);
    if (!existing || scoreCareerSurfaceCandidate(normalized, company) > scoreCareerSurfaceCandidate(existing, company)) {
      byKey.set(key, normalized);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => scoreCareerSurfaceCandidate(right, company) - scoreCareerSurfaceCandidate(left, company))
    .slice(0, Math.max(1, limit));
}
