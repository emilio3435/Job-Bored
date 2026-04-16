import {
  createAtsProvider,
  createListing,
  ensureAbsoluteUrl,
  extractBoardHintCandidates,
  getPathSegments,
  getQueryParam,
  objectValue,
  pickFirstString,
} from "./shared.ts";

const JOBVITE_BOARD_URL_PATTERN = /^https?:\/\/jobs\.jobvite\.com\/[^/?#]+\/?$/i;
const JOBVITE_JOB_URL_PATTERN = /^https?:\/\/jobs\.jobvite\.com\/[^/?#]+\/job\/[^/?#]+/i;

function extractJobviteToken(raw: string): string {
  const segments = getPathSegments(raw);
  if (segments.length > 0) return segments[0];
  return extractBoardHintCandidates(raw)[0] || "";
}

function extractJobviteJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?.id, record?.jobId, record?.requisitionId);
  if (byPayload) return byPayload;
  const byQuery = getQueryParam(raw, "j");
  if (byQuery) return byQuery;
  const segments = getPathSegments(raw);
  const jobIndex = segments.findIndex((segment) => segment === "job");
  return jobIndex >= 0 ? pickFirstString(segments[jobIndex + 1]) : "";
}

export const jobviteProvider = createAtsProvider({
  id: "jobvite",
  sourceLabel: "Jobvite",
  boardUrlPatterns: [JOBVITE_BOARD_URL_PATTERN],
  jobUrlPatterns: [JOBVITE_JOB_URL_PATTERN],
  htmlMarkers: [/jobvite/i, /jobs\.jobvite\.com/i, /Jobvite/i],
  scriptMarkers: [/jobvite/i, /Jobvite\.Apply/i],
  normalizeBoardUrl(raw) {
    const token = extractJobviteToken(raw);
    return token ? `https://jobs.jobvite.com/${encodeURIComponent(token)}` : "";
  },
  normalizeJobUrl(raw) {
    try {
      const segments = getPathSegments(raw);
      if (segments.length >= 3 && segments[1] === "job") {
        return `https://jobs.jobvite.com/${encodeURIComponent(segments[0])}/job/${encodeURIComponent(segments[2])}`;
      }
    } catch {
      return raw.trim();
    }
    return raw.trim();
  },
  extractBoardToken: extractJobviteToken,
  extractJobId: extractJobviteJobId,
  buildPublicApiProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) =>
        `https://jobs.jobvite.com/api/job-list/${encodeURIComponent(token)}?start=0&count=500`,
    );
  },
  buildPublicFeedProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) =>
        `https://jobs.jobvite.com/${encodeURIComponent(token)}/jobs/alljobs`,
    );
  },
  extractListingsFromPayload(payload, input) {
    const record = objectValue(payload);
    const rows = Array.isArray(record?.jobs)
      ? record.jobs
      : Array.isArray(payload)
        ? payload
        : [];
    return rows
      .map((row) => {
        const item = objectValue(row) || {};
        const title = pickFirstString(item.title, item.jobTitle);
        const url = ensureAbsoluteUrl(
          "https://jobs.jobvite.com",
          pickFirstString(item.url, item.jobUrl),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "jobvite",
          sourceLabel: "Jobvite",
          title,
          company: input.companyName || "",
          location: pickFirstString(item.location),
          url,
          jobId: extractJobviteJobId(url, item),
          compensationText: pickFirstString(item.compensation, item.salary),
          descriptionText: pickFirstString(item.description, item.summary),
          tags: [pickFirstString(item.category, item.department)],
          metadata: {
            boardUrl: input.boardUrl || "",
            requisitionId: pickFirstString(item.requisitionId),
          },
        });
      })
      .filter((listing): listing is NonNullable<typeof listing> => !!listing);
  },
});
