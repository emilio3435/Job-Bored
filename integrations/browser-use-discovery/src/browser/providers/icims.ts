import {
  createAtsProvider,
  createListing,
  ensureAbsoluteUrl,
  getPathSegments,
  getQueryParam,
  objectValue,
  pickFirstString,
  safeUrl,
} from "./shared.ts";

const ICIMS_BOARD_URL_PATTERN = /^https?:\/\/[^/]+(?:\.icims\.com)?\/jobs\/search/i;
const ICIMS_JOB_URL_PATTERN = /^https?:\/\/[^/]+(?:\.icims\.com)?\/jobs\/\d+/i;

function normalizeIcimsBoardUrl(raw: string): string {
  const url = safeUrl(raw);
  if (!url) return raw.trim();
  return `${url.origin}/jobs/search`;
}

function normalizeIcimsJobUrl(raw: string): string {
  const url = safeUrl(raw);
  if (!url) return raw.trim();
  const segments = getPathSegments(raw);
  const jobsIndex = segments.findIndex((segment) => segment === "jobs");
  const jobId = jobsIndex >= 0 ? pickFirstString(segments[jobsIndex + 1]) : "";
  const suffix = jobsIndex >= 0 ? pickFirstString(segments[jobsIndex + 2]) : "";
  if (!jobId) return raw.trim();
  return suffix
    ? `${url.origin}/jobs/${encodeURIComponent(jobId)}/${encodeURIComponent(suffix)}`
    : `${url.origin}/jobs/${encodeURIComponent(jobId)}`;
}

function extractIcimsJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?.id, record?.jobId, record?.reqId);
  if (byPayload) return byPayload;
  const byQuery = getQueryParam(raw, "job");
  if (byQuery) return byQuery;
  const segments = getPathSegments(raw);
  const jobsIndex = segments.findIndex((segment) => segment === "jobs");
  return jobsIndex >= 0 ? pickFirstString(segments[jobsIndex + 1]) : "";
}

export const icimsProvider = createAtsProvider({
  id: "icims",
  sourceLabel: "iCIMS",
  boardUrlPatterns: [ICIMS_BOARD_URL_PATTERN],
  jobUrlPatterns: [ICIMS_JOB_URL_PATTERN],
  htmlMarkers: [/icims/i, /jobs\/search/i, /data-ats=["']icims["']/i],
  scriptMarkers: [/iCIMS/i, /icims/i],
  normalizeBoardUrl: normalizeIcimsBoardUrl,
  normalizeJobUrl: normalizeIcimsJobUrl,
  extractBoardToken(raw) {
    return normalizeIcimsBoardUrl(raw);
  },
  extractJobId: extractIcimsJobId,
  buildPublicApiProbeUrls() {
    return [];
  },
  buildPublicFeedProbeUrls(boardHint) {
    const boardUrl = normalizeIcimsBoardUrl(boardHint);
    return boardUrl ? [`${boardUrl}?ss=1`] : [];
  },
  extractListingsFromPayload(payload, input) {
    const record = objectValue(payload);
    const rows = Array.isArray(record?.jobs)
      ? record.jobs
      : Array.isArray(record?.results)
        ? record.results
        : Array.isArray(payload)
          ? payload
          : [];
    return rows
      .map((row) => {
        const item = objectValue(row) || {};
        const title = pickFirstString(item.title, item.jobTitle, item.positionTitle);
        const url = ensureAbsoluteUrl(
          input.boardUrl || normalizeIcimsBoardUrl(input.boardUrl || ""),
          pickFirstString(item.url, item.jobUrl, item.absolute_url),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "icims",
          sourceLabel: "iCIMS",
          title,
          company: input.companyName || "",
          location: pickFirstString(item.location, item.city),
          url,
          jobId: extractIcimsJobId(url, item),
          compensationText: pickFirstString(item.compensation, item.salary),
          descriptionText: pickFirstString(item.description, item.summary),
          tags: [pickFirstString(item.department, item.category)],
          metadata: {
            boardUrl: input.boardUrl || "",
            reqId: pickFirstString(item.reqId),
          },
        });
      })
      .filter((listing): listing is NonNullable<typeof listing> => !!listing);
  },
});
