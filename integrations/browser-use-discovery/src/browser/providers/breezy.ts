import {
  createAtsProvider,
  createListing,
  ensureAbsoluteUrl,
  extractBoardHintCandidates,
  getPathSegments,
  objectValue,
  pickFirstString,
  safeUrl,
} from "./shared.ts";

const BREEZY_BOARD_URL_PATTERN = /^https?:\/\/[^/]+\.breezy\.hr\/?$/i;
const BREEZY_JOB_URL_PATTERN = /^https?:\/\/[^/]+\.breezy\.hr\/p\/[^/?#]+/i;

function extractBreezyToken(raw: string): string {
  const url = safeUrl(raw);
  if (url && /\.breezy\.hr$/i.test(url.hostname)) {
    return pickFirstString(url.hostname.split(".")[0]);
  }
  return extractBoardHintCandidates(raw)[0] || "";
}

function extractBreezyJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?._id, record?.id, record?.jobId);
  if (byPayload) return byPayload;
  const segments = getPathSegments(raw);
  if (segments[0] !== "p") return "";
  const slug = pickFirstString(segments[1]);
  return pickFirstString(slug.split("-")[0], slug);
}

export const breezyProvider = createAtsProvider({
  id: "breezy",
  sourceLabel: "Breezy HR",
  boardUrlPatterns: [BREEZY_BOARD_URL_PATTERN],
  jobUrlPatterns: [BREEZY_JOB_URL_PATTERN],
  htmlMarkers: [/breezy/i, /breezy\.hr/i, /Breezy/i],
  scriptMarkers: [/breezy/i, /positions/i],
  normalizeBoardUrl(raw) {
    const token = extractBreezyToken(raw);
    return token ? `https://${encodeURIComponent(token)}.breezy.hr` : "";
  },
  normalizeJobUrl(raw) {
    const url = safeUrl(raw);
    if (!url) return raw.trim();
    const segments = getPathSegments(raw);
    if (/\.breezy\.hr$/i.test(url.hostname) && segments[0] === "p") {
      return `https://${url.hostname}/p/${encodeURIComponent(pickFirstString(segments[1]))}`;
    }
    return raw.trim();
  },
  extractBoardToken: extractBreezyToken,
  extractJobId: extractBreezyJobId,
  buildPublicApiProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) => `https://${encodeURIComponent(token)}.breezy.hr/json`,
    );
  },
  buildPublicFeedProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) => `https://${encodeURIComponent(token)}.breezy.hr/embed/list`,
    );
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
          input.boardUrl || "",
          pickFirstString(item.url, item.canonical_url),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "breezy",
          sourceLabel: "Breezy HR",
          title,
          company: input.companyName || "",
          location: pickFirstString(
            item.location,
            objectValue(item.location)?.name || "",
          ),
          url,
          jobId: extractBreezyJobId(url, item),
          compensationText: pickFirstString(item.compensation, item.salary),
          descriptionText: pickFirstString(item.description, item.summary),
          tags: [
            pickFirstString(item.department, item.team),
            pickFirstString(item.employment_type, item.employmentType),
          ],
          metadata: {
            boardUrl: input.boardUrl || "",
          },
        });
      })
      .filter((listing): listing is NonNullable<typeof listing> => !!listing);
  },
});
