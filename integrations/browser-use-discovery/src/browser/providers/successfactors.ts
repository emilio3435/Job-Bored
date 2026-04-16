import {
  createAtsProvider,
  createListing,
  ensureAbsoluteUrl,
  getQueryParam,
  objectValue,
  pickFirstString,
  safeUrl,
} from "./shared.ts";

const SUCCESSFACTORS_BOARD_URL_PATTERN =
  /^https?:\/\/[^/]+\.successfactors\.(?:com|eu)\/career/i;
const SUCCESSFACTORS_JOB_URL_PATTERN =
  /^https?:\/\/[^/]+\.successfactors\.(?:com|eu)\/career/i;

function normalizeSuccessFactorsBoardUrl(raw: string): string {
  const url = safeUrl(raw);
  if (!url) return raw.trim();
  const company = pickFirstString(
    url.searchParams.get("company"),
    url.searchParams.get("companyname"),
  );
  if (!company) return `${url.origin}${url.pathname}`;
  return `${url.origin}${url.pathname}?company=${encodeURIComponent(company)}`;
}

function extractSuccessFactorsJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?.jobId, record?.career_job_req_id, record?.id);
  if (byPayload) return byPayload;
  return pickFirstString(
    getQueryParam(raw, "career_job_req_id"),
    getQueryParam(raw, "jobId"),
    getQueryParam(raw, "jobReqId"),
  );
}

function normalizeSuccessFactorsJobUrl(raw: string): string {
  const url = safeUrl(raw);
  if (!url) return raw.trim();
  const jobId = extractSuccessFactorsJobId(raw);
  if (!jobId) return normalizeSuccessFactorsBoardUrl(raw);
  return `${url.origin}${url.pathname}?jobReq=${encodeURIComponent(jobId)}`;
}

export const successFactorsProvider = createAtsProvider({
  id: "successfactors",
  sourceLabel: "SuccessFactors",
  boardUrlPatterns: [SUCCESSFACTORS_BOARD_URL_PATTERN],
  jobUrlPatterns: [SUCCESSFACTORS_JOB_URL_PATTERN, /career_job_req_id=/i, /jobId=/i],
  htmlMarkers: [/successfactors/i, /career_ns=job_listing/i, /career_job_req_id=/i],
  scriptMarkers: [/SuccessFactors/i, /jobReqId/i, /career_job_req_id/i],
  normalizeBoardUrl: normalizeSuccessFactorsBoardUrl,
  normalizeJobUrl: normalizeSuccessFactorsJobUrl,
  extractBoardToken(raw) {
    return normalizeSuccessFactorsBoardUrl(raw);
  },
  extractJobId: extractSuccessFactorsJobId,
  buildPublicApiProbeUrls() {
    return [];
  },
  buildPublicFeedProbeUrls(boardHint) {
    const url = safeUrl(boardHint);
    if (!url) return [];
    const company = pickFirstString(
      url.searchParams.get("company"),
      url.searchParams.get("companyname"),
    );
    if (!company) return [];
    return [
      `${url.origin}${url.pathname}?company=${encodeURIComponent(company)}&career_ns=job_listing_summary`,
    ];
  },
  extractListingsFromPayload(payload, input) {
    const record = objectValue(payload);
    const rows = Array.isArray(record?.jobs)
      ? record.jobs
      : Array.isArray(record?.jobPostings)
        ? record.jobPostings
        : Array.isArray(payload)
          ? payload
          : [];
    return rows
      .map((row) => {
        const item = objectValue(row) || {};
        const title = pickFirstString(item.title, item.jobTitle);
        const url = ensureAbsoluteUrl(
          input.boardUrl || normalizeSuccessFactorsBoardUrl(input.boardUrl || ""),
          pickFirstString(item.url),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "successfactors",
          sourceLabel: "SuccessFactors",
          title,
          company: input.companyName || "",
          location: pickFirstString(item.location),
          url,
          jobId: extractSuccessFactorsJobId(url, item),
          compensationText: pickFirstString(item.compensation, item.salary),
          descriptionText: pickFirstString(item.description, item.summary),
          tags: [pickFirstString(item.department, item.category)],
          metadata: {
            boardUrl: input.boardUrl || "",
          },
        });
      })
      .filter((listing): listing is NonNullable<typeof listing> => !!listing);
  },
});

export const successfactorsProvider = successFactorsProvider;
