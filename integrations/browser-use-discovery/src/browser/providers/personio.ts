import {
  createAtsProvider,
  createListing,
  ensureAbsoluteUrl,
  extractBoardHintCandidates,
  getPathSegments,
  getQueryParam,
  objectValue,
  pickFirstString,
  safeUrl,
} from "./shared.ts";

const PERSONIO_BOARD_URL_PATTERN =
  /^https?:\/\/[^/]+\.jobs\.personio\.(?:de|com)\/?$/i;
const PERSONIO_JOB_URL_PATTERN =
  /^https?:\/\/[^/]+\.jobs\.personio\.(?:de|com)\/job\/[^/?#]+/i;

function extractPersonioToken(raw: string): string {
  const url = safeUrl(raw);
  if (url && /\.jobs\.personio\.(?:de|com)$/i.test(url.hostname)) {
    return pickFirstString(url.hostname.split(".")[0]);
  }
  return extractBoardHintCandidates(raw)[0] || "";
}

function buildPersonioBoardUrl(raw: string): string {
  const url = safeUrl(raw);
  if (url && /\.jobs\.personio\.(?:de|com)$/i.test(url.hostname)) {
    return `https://${url.hostname}`;
  }
  const token = extractPersonioToken(raw);
  return token ? `https://${encodeURIComponent(token)}.jobs.personio.de` : "";
}

function extractPersonioJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?.id, record?.jobId);
  if (byPayload) return byPayload;
  const byQuery = getQueryParam(raw, "jobid");
  if (byQuery) return byQuery;
  const segments = getPathSegments(raw);
  if (segments[0] === "job") return pickFirstString(segments[1]);
  return pickFirstString(segments[segments.length - 1]);
}

export const personioProvider = createAtsProvider({
  id: "personio",
  sourceLabel: "Personio",
  boardUrlPatterns: [PERSONIO_BOARD_URL_PATTERN],
  jobUrlPatterns: [PERSONIO_JOB_URL_PATTERN],
  htmlMarkers: [/personio/i, /jobs\.personio\.(?:de|com)/i, /personio-jobs/i],
  scriptMarkers: [/personio/i, /search\.json/i, /xml/i],
  normalizeBoardUrl: buildPersonioBoardUrl,
  normalizeJobUrl(raw) {
    const url = safeUrl(raw);
    if (!url) return raw.trim();
    const segments = getPathSegments(raw);
    if (/\.jobs\.personio\.(?:de|com)$/i.test(url.hostname) && segments[0] === "job") {
      return `https://${url.hostname}/job/${encodeURIComponent(pickFirstString(segments[1]))}`;
    }
    return raw.trim();
  },
  extractBoardToken: extractPersonioToken,
  extractJobId: extractPersonioJobId,
  buildPublicApiProbeUrls(boardHint) {
    const boardUrl = buildPersonioBoardUrl(boardHint);
    return boardUrl ? [`${boardUrl}/search.json`] : [];
  },
  buildPublicFeedProbeUrls(boardHint) {
    const boardUrl = buildPersonioBoardUrl(boardHint);
    return boardUrl ? [`${boardUrl}/xml`] : [];
  },
  extractListingsFromPayload(payload, input) {
    const record = objectValue(payload);
    const rows = Array.isArray(record?.positions)
      ? record.positions
      : Array.isArray(record?.jobs)
        ? record.jobs
        : Array.isArray(payload)
          ? payload
          : [];
    return rows
      .map((row) => {
        const item = objectValue(row) || {};
        const title = pickFirstString(item.name, item.title);
        const url = ensureAbsoluteUrl(
          input.boardUrl || buildPersonioBoardUrl(input.boardUrl || ""),
          pickFirstString(item.url, item.jobUrl),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "personio",
          sourceLabel: "Personio",
          title,
          company: input.companyName || "",
          location: pickFirstString(item.office, item.location),
          url,
          jobId: extractPersonioJobId(url, item),
          compensationText: pickFirstString(item.compensation, item.salary),
          descriptionText: pickFirstString(item.description, item.summary),
          tags: [pickFirstString(item.department)],
          metadata: {
            boardUrl: input.boardUrl || "",
          },
        });
      })
      .filter((listing): listing is NonNullable<typeof listing> => !!listing);
  },
});
