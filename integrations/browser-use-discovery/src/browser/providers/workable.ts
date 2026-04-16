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

const WORKABLE_BOARD_URL_PATTERN = /^https?:\/\/apply\.workable\.com\/[^/?#]+\/?$/i;
const WORKABLE_JOB_URL_PATTERN =
  /^https?:\/\/apply\.workable\.com\/[^/?#]+\/(?:j\/)?[^/?#]+/i;

function extractWorkableToken(raw: string): string {
  const segments = getPathSegments(raw);
  if (segments.length > 0) return segments[0];
  return extractBoardHintCandidates(raw)[0] || "";
}

function extractWorkableJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?.shortcode, record?.id, record?.jobId);
  if (byPayload) return byPayload;
  const byQuery = getQueryParam(raw, "job");
  if (byQuery) return byQuery;
  const segments = getPathSegments(raw);
  if (segments[1] === "j") return pickFirstString(segments[2]);
  return pickFirstString(segments[1]);
}

export const workableProvider = createAtsProvider({
  id: "workable",
  sourceLabel: "Workable",
  boardUrlPatterns: [WORKABLE_BOARD_URL_PATTERN],
  jobUrlPatterns: [WORKABLE_JOB_URL_PATTERN],
  htmlMarkers: [/workable/i, /apply\.workable\.com/i, /workableJobs/i],
  scriptMarkers: [/workable/i, /apply\.workable\.com/i],
  normalizeBoardUrl(raw) {
    const token = extractWorkableToken(raw);
    return token ? `https://apply.workable.com/${encodeURIComponent(token)}` : "";
  },
  normalizeJobUrl(raw) {
    try {
      const segments = getPathSegments(raw);
      if (segments.length >= 3 && segments[1] === "j") {
        return `https://apply.workable.com/${encodeURIComponent(segments[0])}/j/${encodeURIComponent(segments[2])}`;
      }
      if (segments.length >= 2) {
        return `https://apply.workable.com/${encodeURIComponent(segments[0])}/${encodeURIComponent(segments[1])}`;
      }
    } catch {
      return raw.trim();
    }
    return raw.trim();
  },
  extractBoardToken: extractWorkableToken,
  extractJobId: extractWorkableJobId,
  buildPublicApiProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) =>
        `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(token)}/jobs`,
    );
  },
  buildPublicFeedProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) => `https://apply.workable.com/${encodeURIComponent(token)}/jobs`,
    );
  },
  extractListingsFromPayload(payload, input) {
    const record = objectValue(payload);
    const rows = Array.isArray(record?.results)
      ? record.results
      : Array.isArray(record?.jobs)
        ? record.jobs
        : Array.isArray(payload)
          ? payload
          : [];
    return rows
      .map((row) => {
        const item = objectValue(row) || {};
        const location = objectValue(item.location);
        const title = pickFirstString(item.title, item.name);
        const url = ensureAbsoluteUrl(
          input.boardUrl || "",
          pickFirstString(item.url, item.shortlink, item.application_url),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "workable",
          sourceLabel: "Workable",
          title,
          company: input.companyName || "",
          location: buildLocationText(location?.city, location?.country, item.location),
          url,
          jobId: extractWorkableJobId(url, item),
          compensationText: pickFirstString(item.compensation, item.salary),
          descriptionText: pickFirstString(item.description, item.summary),
          tags: [
            pickFirstString(item.department),
            pickFirstString(item.employment_type, item.employmentType),
          ],
          metadata: {
            boardUrl: input.boardUrl || "",
            shortcode: pickFirstString(item.shortcode),
          },
        });
      })
      .filter((listing): listing is NonNullable<typeof listing> => !!listing);
  },
});
