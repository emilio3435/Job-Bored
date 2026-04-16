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

const TEAMTAILOR_BOARD_URL_PATTERN = /^https?:\/\/[^/]+\.teamtailor\.com\/?$/i;
const TEAMTAILOR_JOB_URL_PATTERN = /^https?:\/\/[^/]+\.teamtailor\.com\/jobs\/[^/?#]+/i;

function extractTeamtailorToken(raw: string): string {
  const url = safeUrl(raw);
  if (url && /\.teamtailor\.com$/i.test(url.hostname)) {
    return pickFirstString(url.hostname.split(".")[0]);
  }
  return extractBoardHintCandidates(raw)[0] || "";
}

function extractTeamtailorJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const attributes = objectValue(record?.attributes);
  const byPayload = pickFirstString(record?.id, attributes?.id, record?.jobId);
  if (byPayload) return byPayload;
  const segments = getPathSegments(raw);
  if (segments[0] !== "jobs") return "";
  const slug = pickFirstString(segments[1]);
  const numericPrefix = slug.match(/^(\d{3,})-/);
  return numericPrefix ? numericPrefix[1] : slug;
}

export const teamtailorProvider = createAtsProvider({
  id: "teamtailor",
  sourceLabel: "Teamtailor",
  boardUrlPatterns: [TEAMTAILOR_BOARD_URL_PATTERN],
  jobUrlPatterns: [TEAMTAILOR_JOB_URL_PATTERN],
  htmlMarkers: [/teamtailor/i, /jobs\.json/i, /Teamtailor/i],
  scriptMarkers: [/teamtailor/i, /jobs\.atom/i],
  normalizeBoardUrl(raw) {
    const token = extractTeamtailorToken(raw);
    return token ? `https://${encodeURIComponent(token)}.teamtailor.com` : "";
  },
  normalizeJobUrl(raw) {
    const url = safeUrl(raw);
    if (!url) return raw.trim();
    const segments = getPathSegments(raw);
    if (/\.teamtailor\.com$/i.test(url.hostname) && segments[0] === "jobs") {
      return `https://${url.hostname}/jobs/${encodeURIComponent(pickFirstString(segments[1]))}`;
    }
    return raw.trim();
  },
  extractBoardToken: extractTeamtailorToken,
  extractJobId: extractTeamtailorJobId,
  buildPublicApiProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) => `https://${encodeURIComponent(token)}.teamtailor.com/jobs.json`,
    );
  },
  buildPublicFeedProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) => `https://${encodeURIComponent(token)}.teamtailor.com/jobs.atom`,
    );
  },
  extractListingsFromPayload(payload, input) {
    const record = objectValue(payload);
    const rows = Array.isArray(record?.jobs)
      ? record.jobs
      : Array.isArray(record?.data)
        ? record.data
        : Array.isArray(payload)
          ? payload
          : [];
    return rows
      .map((row) => {
        const item = objectValue(row) || {};
        const attributes = objectValue(item.attributes);
        const title = pickFirstString(item.title, attributes?.title, attributes?.name);
        const url = ensureAbsoluteUrl(
          input.boardUrl || "",
          pickFirstString(
            item.url,
            attributes?.canonical_url,
            attributes?.url,
          ),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "teamtailor",
          sourceLabel: "Teamtailor",
          title,
          company: input.companyName || "",
          location: pickFirstString(
            item.location,
            attributes?.location,
            objectValue(attributes?.location)?.name || "",
          ),
          url,
          jobId: extractTeamtailorJobId(url, item),
          compensationText: pickFirstString(item.compensation, attributes?.salary),
          descriptionText: pickFirstString(
            item.description,
            attributes?.body,
            attributes?.description,
          ),
          tags: [
            pickFirstString(item.department, attributes?.department),
            pickFirstString(item.employment_type, attributes?.employment_type),
          ],
          metadata: {
            boardUrl: input.boardUrl || "",
          },
        });
      })
      .filter((listing): listing is NonNullable<typeof listing> => !!listing);
  },
});
