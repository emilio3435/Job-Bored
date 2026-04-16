import {
  arrayOfStrings,
  buildLocationText,
  createAtsProvider,
  createListing,
  ensureAbsoluteUrl,
  getPathSegments,
  getQueryParam,
  objectValue,
  pickFirstString,
  safeUrl,
} from "./shared.ts";

const WORKDAY_BOARD_URL_PATTERN =
  /^https?:\/\/[^/]+\.(?:myworkdayjobs|workdayjobs)\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[^/?#]+\/?$/i;
const WORKDAY_JOB_URL_PATTERN =
  /^https?:\/\/[^/]+\.(?:myworkdayjobs|workdayjobs)\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[^/?#]+\/job\/[^/?#]+/i;

function parseWorkdayContext(raw: string) {
  const url = safeUrl(raw);
  if (!url) return null;
  const segments = getPathSegments(raw);
  const host = url.hostname;
  const localePattern = /^[a-z]{2}-[A-Z]{2}$/;
  if (segments[0] === "wday" && segments[1] === "cxs") {
    const tenant = pickFirstString(segments[2], host.split(".")[0]);
    const site = pickFirstString(segments[3]);
    return {
      origin: url.origin,
      host,
      locale: "",
      site,
      tenant,
      boardUrl: site ? `${url.origin}/${site}` : url.origin,
    };
  }
  const locale = localePattern.test(segments[0] || "") ? segments[0] : "";
  const site = locale ? pickFirstString(segments[1]) : pickFirstString(segments[0]);
  const boardPath = locale && site ? `/${locale}/${site}` : site ? `/${site}` : "";
  return {
    origin: url.origin,
    host,
    locale,
    site,
    tenant: host.split(".")[0],
    boardUrl: boardPath ? `${url.origin}${boardPath}` : url.origin,
  };
}

function extractWorkdayJobId(raw: string, payload?: unknown): string {
  const record = objectValue(payload);
  const byPayload = pickFirstString(
    record?.jobReqId,
    record?.jobRequisitionId,
    record?.externalJobPostingId,
    record?.id,
  );
  if (byPayload) return byPayload;
  const fromQuery = pickFirstString(
    getQueryParam(raw, "jobId"),
    getQueryParam(raw, "jobReqId"),
  );
  if (fromQuery) return fromQuery;
  const segments = getPathSegments(raw);
  const last = pickFirstString(segments[segments.length - 1]);
  const suffix = last.match(/_([A-Za-z0-9-]+)$/);
  return suffix ? suffix[1] : last;
}

export const workdayProvider = createAtsProvider({
  id: "workday",
  sourceLabel: "Workday",
  boardUrlPatterns: [WORKDAY_BOARD_URL_PATTERN],
  jobUrlPatterns: [WORKDAY_JOB_URL_PATTERN, /\/wday\/cxs\/[^/]+\/[^/]+\/job\//i],
  htmlMarkers: [
    /myworkdayjobs\.com/i,
    /workdayjobs\.com/i,
    /workday/i,
    /wd-PageContent/i,
  ],
  scriptMarkers: [/wday\/cxs\//i, /__INITIAL_STATE__/i, /wd-PageContext/i],
  normalizeBoardUrl(raw) {
    return parseWorkdayContext(raw)?.boardUrl || raw.trim();
  },
  normalizeJobUrl(raw) {
    try {
      const url = new URL(raw);
      url.hash = "";
      url.search = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return raw.trim();
    }
  },
  extractBoardToken(raw) {
    return parseWorkdayContext(raw)?.boardUrl || "";
  },
  extractJobId: extractWorkdayJobId,
  buildPublicApiProbeUrls(boardHint) {
    const context = parseWorkdayContext(boardHint);
    if (!context?.site) return [];
    return [
      `${context.origin}/wday/cxs/${encodeURIComponent(context.tenant)}/${encodeURIComponent(context.site)}/jobs`,
    ];
  },
  buildPublicFeedProbeUrls() {
    return [];
  },
  extractListingsFromPayload(payload, input) {
    const record = objectValue(payload);
    const rows = Array.isArray(record?.jobPostings)
      ? record.jobPostings
      : Array.isArray(record?.jobs)
        ? record.jobs
        : Array.isArray(payload)
          ? payload
          : [];
    return rows
      .map((row) => {
        const item = objectValue(row) || {};
        const title = pickFirstString(item.title, item.postingTitle, item.jobTitle);
        const url = ensureAbsoluteUrl(
          input.boardUrl || "",
          pickFirstString(item.externalPath, item.externalUrl, item.url),
        );
        if (!title || !url) return null;
        return createListing({
          providerId: "workday",
          sourceLabel: "Workday",
          title,
          company: input.companyName || "",
          location: buildLocationText(
            item.locationsText,
            item.location,
            ...arrayOfStrings(item.locations),
          ),
          url,
          jobId: extractWorkdayJobId(url, item),
          compensationText: pickFirstString(item.compensation, item.salary),
          descriptionText: pickFirstString(item.description, item.jobDescription),
          tags: [
            pickFirstString(item.timeType),
            pickFirstString(item.workerSubType),
            ...arrayOfStrings(item.bulletFields),
          ],
          metadata: {
            boardUrl: input.boardUrl || "",
            externalJobPostingId: pickFirstString(item.externalJobPostingId),
          },
        });
      })
      .filter((listing): listing is NonNullable<typeof listing> => !!listing);
  },
});
