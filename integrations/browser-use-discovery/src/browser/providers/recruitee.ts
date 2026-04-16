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

const RECRUITEE_BOARD_URL_PATTERN = /^https?:\/\/[^/]+\.recruitee\.com\/?$/i;
const RECRUITEE_JOB_URL_PATTERN = /^https?:\/\/[^/]+\.recruitee\.com\/o\/[^/?#]+/i;

function extractRecruiteeToken(raw: string): string {
  const url = safeUrl(raw);
  if (url && /\.recruitee\.com$/i.test(url.hostname)) {
    return pickFirstString(url.hostname.split(".")[0]);
  }
  return extractBoardHintCandidates(raw)[0] || "";
}

function extractRecruiteeJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(record?.id, record?.jobId);
  if (byPayload) return byPayload;
  const segments = getPathSegments(raw);
  return segments.length >= 2 ? pickFirstString(segments[1]) : "";
}

export const recruiteeProvider = createAtsProvider({
  id: "recruitee",
  sourceLabel: "Recruitee",
  boardUrlPatterns: [RECRUITEE_BOARD_URL_PATTERN],
  jobUrlPatterns: [RECRUITEE_JOB_URL_PATTERN],
  htmlMarkers: [/recruitee/i, /api\/offers/i, /recruitee-api/i],
  scriptMarkers: [/recruitee/i, /offers/i],
  normalizeBoardUrl(raw) {
    const token = extractRecruiteeToken(raw);
    return token ? `https://${encodeURIComponent(token)}.recruitee.com` : "";
  },
  normalizeJobUrl(raw) {
    const url = safeUrl(raw);
    if (!url) return raw.trim();
    const segments = getPathSegments(raw);
    if (/\.recruitee\.com$/i.test(url.hostname) && segments[0] === "o") {
      return `https://${url.hostname}/o/${encodeURIComponent(pickFirstString(segments[1]))}`;
    }
    return raw.trim();
  },
  extractBoardToken: extractRecruiteeToken,
  extractJobId: extractRecruiteeJobId,
  buildPublicApiProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) => `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`,
    );
  },
  buildPublicFeedProbeUrls(boardHint) {
    return extractBoardHintCandidates(boardHint).map(
      (token) => `https://${encodeURIComponent(token)}.recruitee.com/o`,
    );
  },
  extractListingsFromPayload(payload, input) {
    const record = objectValue(payload);
    const rows = Array.isArray(record?.offers)
      ? record.offers
      : Array.isArray(record?.jobs)
        ? record.jobs
        : Array.isArray(payload)
          ? payload
          : [];
    return rows
      .map((row) => {
        const item = objectValue(row) || {};
        const title = pickFirstString(item.title, item.name);
        const url = ensureAbsoluteUrl(
          input.boardUrl || "",
          pickFirstString(item.careers_url, item.url),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "recruitee",
          sourceLabel: "Recruitee",
          title,
          company: input.companyName || "",
          location: pickFirstString(
            item.location,
            objectValue(item.location)?.name || "",
            objectValue(item.location)?.city || "",
          ),
          url,
          jobId: extractRecruiteeJobId(url, item),
          compensationText: pickFirstString(item.compensation, item.salary),
          descriptionText: pickFirstString(item.description, item.summary),
          tags: [
            pickFirstString(
              objectValue(item.department)?.name || "",
              item.department,
            ),
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
