import {
  buildLocationText,
  createAtsProvider,
  createListing,
  ensureAbsoluteUrl,
  extractBoardHintCandidates,
  getPathSegments,
  getQueryParam,
  objectValue,
  pickFirstString,
} from "./shared.ts";

export const SMARTRECRUITERS_BOARD_URL_PATTERN =
  /^https?:\/\/jobs\.smartrecruiters\.com\/[^/?#]+\/?$/i;
export const SMARTRECRUITERS_JOB_URL_PATTERN =
  /^https?:\/\/jobs\.smartrecruiters\.com\/[^/?#]+\/[^/?#]+/i;
export const SMARTRECRUITERS_HTML_MARKERS = [
  /smartrecruiters/i,
  /jobs\.smartrecruiters\.com/i,
  /data-smartrecruiters/i,
];
export const SMARTRECRUITERS_SCRIPT_MARKERS = [
  /smartRecruiters/i,
  /jobAd/i,
  /smartrecruiters/i,
];

export function extractSmartrecruitersToken(raw: string): string {
  const segments = getPathSegments(raw);
  if (segments.length > 0) return segments[0];
  return extractBoardHintCandidates(raw)[0] || "";
}

export function extractSmartrecruitersJobId(
  raw: string,
  payload?: unknown,
): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?.id, record?.ref, record?.jobId);
  if (byPayload) return byPayload;
  const byQuery = pickFirstString(
    getQueryParam(raw, "jobId"),
    getQueryParam(raw, "ref"),
  );
  if (byQuery) return byQuery;
  const segments = getPathSegments(raw);
  if (segments.length < 2) return "";
  const slug = pickFirstString(segments[1]);
  const numericPrefix = slug.match(/^(\d{6,})[-_]?/);
  return numericPrefix ? numericPrefix[1] : slug;
}

export function normalizeSmartrecruitersBoardUrl(raw: string): string {
  const token = extractSmartrecruitersToken(raw);
  return token
    ? `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}`
    : "";
}

export function normalizeSmartrecruitersJobUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const segments = getPathSegments(raw);
    if (url.hostname === "jobs.smartrecruiters.com" && segments.length >= 2) {
      return `https://jobs.smartrecruiters.com/${encodeURIComponent(segments[0])}/${encodeURIComponent(segments[1])}`;
    }
  } catch {
    return raw.trim();
  }
  return raw.trim();
}

export function buildSmartrecruitersApiProbeUrls(
  boardHint: string,
): string[] {
  return extractBoardHintCandidates(boardHint).map(
    (token) =>
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`,
  );
}

export function buildSmartrecruitersFeedProbeUrls(
  boardHint: string,
): string[] {
  return extractBoardHintCandidates(boardHint).map(
    (token) =>
      `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/feed.xml`,
  );
}

function slugifySmartrecruitersText(input: unknown): string {
  return pickFirstString(input)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSmartrecruitersJobUrl(
  token: string,
  record: Record<string, unknown>,
): string {
  const existing = pickFirstString(
    record.applyUrl,
    record.jobUrl,
    record.url,
  );
  if (existing) return existing;
  const ref = pickFirstString(record.ref, record.id);
  if (!token || !ref) return "";
  const slug = slugifySmartrecruitersText(record.name || record.title || ref);
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${encodeURIComponent(`${ref}${slug ? `-${slug}` : ""}`)}`;
}

export function extractSmartrecruitersListings(
  payload: unknown,
  input: { boardUrl: string; companyName: string },
) {
  const record = objectValue(payload);
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.content)
      ? record.content
      : Array.isArray(record?.jobs)
        ? record.jobs
        : Array.isArray(record?.postings)
          ? record.postings
          : Array.isArray(record?.data)
            ? record.data
            : [];
  const token = extractSmartrecruitersToken(input.boardUrl || "");
  return rows
    .map((row) => {
      const item = objectValue(row) || {};
      const location = objectValue(item.location);
      const department = objectValue(item.department);
      const jobAd = objectValue(item.jobAd);
      const sections = objectValue(jobAd?.sections);
      const title = pickFirstString(item.name, item.title);
      const url = ensureAbsoluteUrl(
        input.boardUrl || "",
        buildSmartrecruitersJobUrl(token, item),
      );
      if (!title || !url) return null;
      return createListing({
        providerId: "smartrecruiters",
        sourceLabel: "SmartRecruiters",
        title,
        company: input.companyName || "",
        location: buildLocationText(
          location?.formattedAddress,
          location?.city,
          location?.region,
          location?.country,
          item.location,
        ),
        url,
        jobId: extractSmartrecruitersJobId(url, item),
        compensationText: pickFirstString(
          item.compensation,
          item.salary,
          jobAd?.salary,
        ),
        descriptionText: pickFirstString(
          objectValue(sections?.jobDescription)?.text || "",
          jobAd?.description,
          item.description,
        ),
        tags: [
          pickFirstString(department?.label, department?.name, item.department),
          pickFirstString(item.typeOfEmployment, item.employmentType),
        ],
        metadata: {
          boardUrl: input.boardUrl || "",
          ref: pickFirstString(item.ref),
          externalJobId: pickFirstString(item.id),
        },
      });
    })
    .filter((listing): listing is NonNullable<typeof listing> => !!listing);
}

export const smartrecruitersProvider = createAtsProvider({
  id: "smartrecruiters",
  sourceLabel: "SmartRecruiters",
  boardUrlPatterns: [SMARTRECRUITERS_BOARD_URL_PATTERN],
  jobUrlPatterns: [SMARTRECRUITERS_JOB_URL_PATTERN],
  htmlMarkers: SMARTRECRUITERS_HTML_MARKERS,
  scriptMarkers: SMARTRECRUITERS_SCRIPT_MARKERS,
  normalizeBoardUrl: normalizeSmartrecruitersBoardUrl,
  normalizeJobUrl: normalizeSmartrecruitersJobUrl,
  extractBoardToken: extractSmartrecruitersToken,
  extractJobId: extractSmartrecruitersJobId,
  buildPublicApiProbeUrls: buildSmartrecruitersApiProbeUrls,
  buildPublicFeedProbeUrls: buildSmartrecruitersFeedProbeUrls,
  extractListingsFromPayload: extractSmartrecruitersListings,
});

export const smartRecruitersProvider = smartrecruitersProvider;
