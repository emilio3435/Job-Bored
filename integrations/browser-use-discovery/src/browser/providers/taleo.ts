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

const TALEO_BOARD_URL_PATTERN =
  /^https?:\/\/[^/]+\.taleo\.net\/careersection\/[^/]+\/jobsearch\.ftl/i;
const TALEO_JOB_URL_PATTERN =
  /^https?:\/\/[^/]+\.taleo\.net\/careersection\/[^/]+\/jobdetail\.ftl/i;

function normalizeTaleoBoardUrl(raw: string): string {
  const url = safeUrl(raw);
  if (!url) return raw.trim();
  const segments = getPathSegments(raw);
  const idx = segments.findIndex((segment) => segment === "careersection");
  const section = idx >= 0 ? pickFirstString(segments[idx + 1]) : "";
  if (!section) return raw.trim();
  return `${url.origin}/careersection/${encodeURIComponent(section)}/jobsearch.ftl`;
}

function normalizeTaleoJobUrl(raw: string): string {
  const url = safeUrl(raw);
  if (!url) return raw.trim();
  const segments = getPathSegments(raw);
  const idx = segments.findIndex((segment) => segment === "careersection");
  const section = idx >= 0 ? pickFirstString(segments[idx + 1]) : "";
  const jobId = getQueryParam(raw, "job");
  if (!section || !jobId) return raw.trim();
  return `${url.origin}/careersection/${encodeURIComponent(section)}/jobdetail.ftl?job=${encodeURIComponent(jobId)}`;
}

function extractTaleoJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?.job, record?.jobId, record?.id);
  if (byPayload) return byPayload;
  return getQueryParam(raw, "job");
}

export const taleoProvider = createAtsProvider({
  id: "taleo",
  sourceLabel: "Taleo",
  boardUrlPatterns: [TALEO_BOARD_URL_PATTERN],
  jobUrlPatterns: [TALEO_JOB_URL_PATTERN],
  htmlMarkers: [/taleo/i, /jobsearch\.ftl/i, /jobdetail\.ftl/i],
  scriptMarkers: [/taleo/i, /jobsearch\.ftl/i],
  normalizeBoardUrl: normalizeTaleoBoardUrl,
  normalizeJobUrl: normalizeTaleoJobUrl,
  extractBoardToken(raw) {
    return normalizeTaleoBoardUrl(raw);
  },
  extractJobId: extractTaleoJobId,
  buildPublicApiProbeUrls() {
    return [];
  },
  buildPublicFeedProbeUrls(boardHint) {
    const boardUrl = normalizeTaleoBoardUrl(boardHint);
    return boardUrl ? [boardUrl] : [];
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
          input.boardUrl || normalizeTaleoBoardUrl(input.boardUrl || ""),
          pickFirstString(item.url),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "taleo",
          sourceLabel: "Taleo",
          title,
          company: input.companyName || "",
          location: pickFirstString(item.location),
          url,
          jobId: extractTaleoJobId(url, item),
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
