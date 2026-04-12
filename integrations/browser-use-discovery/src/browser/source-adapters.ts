import type {
  AtsSourceId,
  BoardContext,
  CompanyContext,
  CompanyTarget,
  DetectionResult,
  DiscoveryRun,
  NormalizedLead,
  RawListing,
  SourceAdapter,
  SupportedSourceId,
} from "../contracts.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import type { BrowserUseSessionManager } from "./session.ts";
import {
  ASHBY_BROWSER_INSTRUCTION,
  GREENHOUSE_BROWSER_INSTRUCTION,
  LEVER_BROWSER_INSTRUCTION,
  buildAshbyBoardUrl,
  buildAshbyJobsUrl,
  buildGreenhouseBoardInfoUrl,
  buildGreenhouseBoardUrl,
  buildGreenhouseJobsUrl,
  buildLeverBoardUrl,
  buildLeverJobsUrl,
  compactCompanyTokens,
  extractTokenFromBoardHint,
  sanitizeCompensationText,
  slugifyCompanyName,
  stripHtml,
  toPlainText,
} from "./selectors/index.ts";

export type SourceAdapterRegistry = {
  adapters: SourceAdapter[];
  detectBoards(
    companyContext: CompanyContext,
    effectiveSources: SupportedSourceId[],
  ): Promise<DetectionResult[]>;
  collectListings(
    run: DiscoveryRun,
    detections: DetectionResult[],
  ): Promise<RawListing[]>;
};

export function createSourceAdapterRegistry(
  sessionManager: BrowserUseSessionManager,
): SourceAdapterRegistry {
  const adapters = [
    createGreenhouseAdapter(sessionManager),
    createLeverAdapter(sessionManager),
    createAshbyAdapter(sessionManager),
  ];
  return {
    adapters,
    async detectBoards(companyContext, effectiveSources) {
      const effectiveSet = new Set(effectiveSources);
      const eligibleAdapters = adapters.filter((adapter) =>
        effectiveSet.has(adapter.sourceId),
      );
      const results = await Promise.all(
        eligibleAdapters.map((adapter) => adapter.detect(companyContext)),
      );
      return results.filter(
        (entry): entry is DetectionResult => !!entry && entry.matched,
      );
    },
    async collectListings(run, detections) {
      const enabled = new Set(run.config.enabledSources);
      const seen = new Set<string>();
      const listings: RawListing[] = [];
      for (const detection of detections) {
        if (!enabled.has(detection.sourceId)) continue;
        const adapter = adapters.find(
          (candidate) => candidate.sourceId === detection.sourceId,
        );
        if (!adapter) continue;
        const company =
          run.config.companies.find((entry) => {
            const slug = slugifyCompanyName(entry.name);
            return (
              detection.boardUrl.includes(slug) ||
              slugifyCompanyName(detection.sourceLabel) === slug
            );
          }) ?? run.config.companies[0];
        if (!company) continue;
        const boardContext = buildBoardContext({ company, run }, detection);
        const raw = await adapter.listJobs(boardContext);
        for (const item of raw) {
          const key = normalizeLeadUrl(item.url);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          listings.push(item);
        }
      }
      return listings;
    },
  };
}

export function buildBoardContext(
  companyContext: CompanyContext,
  detection: DetectionResult,
): BoardContext {
  return {
    sourceId: detection.sourceId,
    sourceLabel: detection.sourceLabel,
    boardUrl: detection.boardUrl,
    company: companyContext.company,
    run: companyContext.run,
  };
}

type AdapterDefinition = {
  sourceId: AtsSourceId;
  sourceLabel: string;
  buildBoardUrl(boardToken: string): string;
  buildJobsUrl(boardToken: string): string;
  browserInstruction: string;
  detectEndpoint(boardToken: string): string;
  extractListingPayload(raw: unknown, boardContext: BoardContext): RawListing[];
  fallbackListingFromHtml(
    html: string,
    boardContext: BoardContext,
  ): RawListing[];
};

function createGreenhouseAdapter(
  sessionManager: BrowserUseSessionManager,
): SourceAdapter {
  return buildAdapter(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      buildBoardUrl: buildGreenhouseBoardUrl,
      buildJobsUrl: buildGreenhouseJobsUrl,
      browserInstruction: GREENHOUSE_BROWSER_INSTRUCTION,
      detectEndpoint: buildGreenhouseBoardInfoUrl,
      extractListingPayload: (payload, boardContext) =>
        extractGreenhouseListings(payload, boardContext),
      fallbackListingFromHtml: (html, boardContext) =>
        extractLinksFromHtml(
          html,
          boardContext,
          /boards\.greenhouse\.io\/[^"'\\s>]+\/jobs\/\d+/i,
        ),
    },
    sessionManager,
  );
}

function createLeverAdapter(
  sessionManager: BrowserUseSessionManager,
): SourceAdapter {
  return buildAdapter(
    {
      sourceId: "lever",
      sourceLabel: "Lever",
      buildBoardUrl: buildLeverBoardUrl,
      buildJobsUrl: buildLeverJobsUrl,
      browserInstruction: LEVER_BROWSER_INSTRUCTION,
      detectEndpoint: buildLeverJobsUrl,
      extractListingPayload: (payload, boardContext) =>
        extractLeverListings(payload, boardContext),
      fallbackListingFromHtml: (html, boardContext) =>
        extractLinksFromHtml(
          html,
          boardContext,
          /jobs\.lever\.co\/[^"'\\s>]+/i,
        ),
    },
    sessionManager,
  );
}

function createAshbyAdapter(
  sessionManager: BrowserUseSessionManager,
): SourceAdapter {
  return buildAdapter(
    {
      sourceId: "ashby",
      sourceLabel: "Ashby",
      buildBoardUrl: buildAshbyBoardUrl,
      buildJobsUrl: buildAshbyJobsUrl,
      browserInstruction: ASHBY_BROWSER_INSTRUCTION,
      detectEndpoint: (boardToken) => buildAshbyJobsUrl(boardToken, false),
      extractListingPayload: (payload, boardContext) =>
        extractAshbyListings(payload, boardContext),
      fallbackListingFromHtml: (html, boardContext) =>
        extractLinksFromHtml(
          html,
          boardContext,
          /jobs\.ashbyhq\.com\/[^"'\\s>]+/i,
        ),
    },
    sessionManager,
  );
}

function buildAdapter(
  definition: AdapterDefinition,
  sessionManager: BrowserUseSessionManager,
): SourceAdapter {
  return {
    sourceId: definition.sourceId,
    sourceLabel: definition.sourceLabel,
    async detect(companyContext) {
      const hints = candidateBoardTokens(
        companyContext.company,
        definition.sourceId,
      );
      for (const token of hints) {
        const endpoint = definition.detectEndpoint(token);
        const payload = await fetchJson(endpoint);
        if (payload.ok) {
          const boardUrl = definition.buildBoardUrl(token);
          return {
            matched: true,
            sourceId: definition.sourceId,
            sourceLabel: definition.sourceLabel,
            boardUrl,
            confidence: token === hints[0] ? 1 : 0.8,
            warnings: [],
          };
        }
        const sessionResult = await sessionManager.run({
          url: definition.buildBoardUrl(token),
          instruction: definition.browserInstruction,
          timeoutMs: 15_000,
        });
        if (looksLikeSourceBoard(sessionResult.text, definition.sourceId)) {
          return {
            matched: true,
            sourceId: definition.sourceId,
            sourceLabel: definition.sourceLabel,
            boardUrl: definition.buildBoardUrl(token),
            confidence: 0.5,
            warnings: [
              "Detected via Browser Use fallback rather than public API.",
            ],
          };
        }
      }
      return null;
    },
    async listJobs(boardContext) {
      const boardToken =
        extractBoardToken(boardContext.boardUrl) ||
        candidateBoardTokens(boardContext.company, definition.sourceId)[0];
      const endpoint = definition.buildJobsUrl(boardToken);
      const payload = await fetchJson(endpoint);
      if (payload.ok) {
        const listings = definition.extractListingPayload(
          payload.data,
          boardContext,
        );
        if (listings.length) return listings;
      }

      const sessionResult = await sessionManager.run({
        url: endpoint,
        instruction: definition.browserInstruction,
        timeoutMs: 20_000,
      });
      const sessionPayload = tryParseJson(sessionResult.text);
      if (sessionPayload) {
        const listings = definition.extractListingPayload(
          sessionPayload,
          boardContext,
        );
        if (listings.length) return listings;
      }
      return definition.fallbackListingFromHtml(
        sessionResult.text,
        boardContext,
      );
    },
    async normalize(raw, run): Promise<NormalizedLead | null> {
      if (!raw.url) return null;
      const sourceQuery =
        raw.metadata && typeof raw.metadata === "object"
          ? String((raw.metadata as Record<string, unknown>).sourceQuery || "")
          : "";
      return {
        sourceId: raw.sourceId,
        sourceLabel: raw.sourceLabel,
        title: normalizeWhitespace(raw.title),
        company: normalizeWhitespace(raw.company),
        location: normalizeWhitespace(raw.location || ""),
        url: normalizeLeadUrl(raw.url),
        compensationText: sanitizeCompensationText(raw.compensationText || ""),
        fitScore: null,
        priority: "",
        tags: sanitizeTags(raw.tags || []),
        fitAssessment: sanitizeDescriptionText(raw.descriptionText).slice(
          0,
          500,
        ),
        contact: normalizeWhitespace(raw.contact || ""),
        status: "New",
        appliedDate: "",
        notes: "",
        followUpDate: "",
        talkingPoints: "",
        logoUrl: "",
        discoveredAt: run.request.requestedAt || new Date().toISOString(),
        metadata: {
          runId: run.runId,
          variationKey: run.request.variationKey,
          sourceQuery: sourceQuery || `${raw.sourceLabel}:${raw.url}`,
        },
      };
    },
  };
}

function candidateBoardTokens(
  company: CompanyTarget,
  sourceId: AtsSourceId,
): string[] {
  const hint = company.boardHints?.[sourceId];
  const tokens = new Set<string>();
  if (hint) {
    const extracted = extractTokenFromBoardHint(hint);
    if (extracted) tokens.add(extracted);
  }
  for (const token of compactCompanyTokens(company.name)) {
    tokens.add(token);
  }
  return [...tokens].filter(Boolean);
}

function extractBoardToken(boardUrl: string): string {
  return extractTokenFromBoardHint(boardUrl);
}

function extractGreenhouseListings(
  payload: unknown,
  boardContext: BoardContext,
): RawListing[] {
  const jobs = Array.isArray(payload)
    ? payload
    : isPlainObject(payload) && Array.isArray(payload.jobs)
      ? payload.jobs
      : [];
  return jobs
    .map((job) => {
      const record = isPlainObject(job) ? job : {};
      const title = stringValue(record.title) || stringValue(record.name);
      const url = stringValue(record.absolute_url) || stringValue(record.url);
      const location =
        objectString(record.location, "name") || stringValue(record.location);
      const metadata = objectValue(record.metadata);
      return {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title,
        company: boardContext.company.name,
        location,
        url,
        compensationText: extractGreenhouseCompensation(record),
        contact: "",
        descriptionText: sanitizeDescriptionText(record.content),
        tags: [
          ...stringArrayFrom(record.departments),
          ...stringArrayFrom(record.offices),
        ],
        metadata: {
          sourceQuery: boardContext.boardUrl,
          jobId: record.id,
          internalJobId: record.internal_job_id,
        },
      };
    })
    .filter((item) => !!item.url && !!item.title);
}

function extractLeverListings(
  payload: unknown,
  boardContext: BoardContext,
): RawListing[] {
  const rows = Array.isArray(payload)
    ? payload
    : isPlainObject(payload) && Array.isArray(payload.postings)
      ? payload.postings
      : isPlainObject(payload) && Array.isArray(payload.jobs)
        ? payload.jobs
        : [];
  return rows
    .map((row) => {
      const record = isPlainObject(row) ? row : {};
      const categories = objectValue(record.categories);
      const tags = [
        stringValue(categories.team),
        stringValue(categories.department),
        stringValue(categories.commitment),
        stringValue(categories.location),
      ].filter(Boolean);
      return {
        sourceId: "lever",
        sourceLabel: "Lever",
        title: stringValue(record.text) || stringValue(record.title),
        company: boardContext.company.name,
        location:
          stringValue(categories.location) || stringValue(record.location),
        url:
          stringValue(record.hostedUrl) ||
          stringValue(record.applyUrl) ||
          stringValue(record.url),
        compensationText:
          sanitizeCompensationValue(record.salaryRange) ||
          sanitizeCompensationValue(record.compensation),
        contact: stringValue(record.leadName) || stringValue(record.contact),
        descriptionText:
          sanitizeDescriptionText(record.description) ||
          sanitizeDescriptionText(record.text),
        tags,
        metadata: {
          sourceQuery: boardContext.boardUrl,
          postingId: record.id,
        },
      };
    })
    .filter((item) => !!item.url && !!item.title);
}

function extractAshbyListings(
  payload: unknown,
  boardContext: BoardContext,
): RawListing[] {
  const jobs =
    isPlainObject(payload) && Array.isArray(payload.jobs) ? payload.jobs : [];
  return jobs
    .map((job) => {
      const record = isPlainObject(job) ? job : {};
      const secondaryLocations = arrayOfObjects(record.secondaryLocations)
        .map((entry) => stringValue(entry.location))
        .filter(Boolean);
      const jobUrl =
        stringValue(record.jobUrl) ||
        stringValue(record.url) ||
        stringValue(record.absoluteUrl) ||
        buildAshbyBoardUrl(extractBoardToken(boardContext.boardUrl));
      const locations = [
        stringValue(record.location),
        ...secondaryLocations,
      ].filter(Boolean);
      const tags = [
        stringValue(record.department),
        stringValue(record.team),
        stringValue(record.employmentType),
      ].filter(Boolean);
      return {
        sourceId: "ashby",
        sourceLabel: "Ashby",
        title: stringValue(record.title),
        company: boardContext.company.name,
        location: locations.join(", "),
        url: jobUrl,
        compensationText:
          sanitizeCompensationValue(record.compensation) ||
          sanitizeCompensationValue(record.compensationText),
        contact: "",
        descriptionText:
          sanitizeDescriptionText(record.descriptionHtml) ||
          sanitizeDescriptionText(record.description),
        tags,
        metadata: {
          sourceQuery: boardContext.boardUrl,
          jobId: record.id,
        },
      };
    })
    .filter((item) => !!item.url && !!item.title);
}

function extractLinksFromHtml(
  html: string,
  boardContext: BoardContext,
  pattern: RegExp,
): RawListing[] {
  const listings: RawListing[] = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(String(html || "")))) {
    const href = match[1] || "";
    if (!pattern.test(href)) continue;
    const resolved = resolveRelativeUrl(boardContext.boardUrl, href);
    if (!/^https?:\/\//i.test(resolved)) continue;
    const title = stripHtml(match[2]);
    if (!title) continue;
    listings.push({
      sourceId: boardContext.sourceId,
      sourceLabel: boardContext.sourceLabel,
      title,
      company: boardContext.company.name,
      location: "",
      url: normalizeLeadUrl(resolved),
      compensationText: "",
      contact: "",
      descriptionText: "",
      tags: [],
      metadata: {
        sourceQuery: boardContext.boardUrl,
        extractionMode: "html",
      },
    });
  }
  return dedupeRawListings(listings);
}

async function fetchJson(
  url: string,
): Promise<{ ok: boolean; data?: unknown; status: number }> {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    const text = await response.text();
    const data = tryParseJson(text);
    return { ok: response.ok, data: data ?? text, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function looksLikeSourceBoard(
  text: string,
  sourceId: AtsSourceId,
): boolean {
  const haystack = String(text || "").toLowerCase();
  if (!haystack) return false;
  if (sourceId === "greenhouse") {
    return haystack.includes("greenhouse") || haystack.includes('href="/jobs/');
  }
  if (sourceId === "lever") {
    return haystack.includes("lever") || haystack.includes("jobs.lever.co");
  }
  return haystack.includes("ashby") || haystack.includes("jobs.ashbyhq.com");
}

function resolveRelativeUrl(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function dedupeRawListings(listings: RawListing[]): RawListing[] {
  const seen = new Set<string>();
  const out: RawListing[] = [];
  for (const item of listings) {
    const key = normalizeLeadUrl(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeWhitespace(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function toPlainTextValue(value: unknown): string {
  return toPlainText(stringValue(value));
}

function sanitizeDescriptionText(value: unknown): string {
  return toPlainTextValue(value);
}

function sanitizeCompensationValue(value: unknown): string {
  return sanitizeCompensationText(stringValue(value));
}

function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const value = normalizeWhitespace(tag);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return normalizeWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

function tryParseJson(input: string): unknown | null {
  try {
    return JSON.parse(String(input || ""));
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringArrayFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) =>
      isPlainObject(entry) ? stringValue(entry.name) : stringValue(entry),
    )
    .filter(Boolean);
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject);
}

function objectValue(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function objectString(value: unknown, key: string): string {
  return stringValue(objectValue(value)[key]);
}

function extractGreenhouseCompensation(
  record: Record<string, unknown>,
): string {
  const metadataObject = objectValue(record.metadata);
  for (const candidate of [
    metadataObject.compensation,
    metadataObject.compensation_text,
    metadataObject.compensationRange,
    metadataObject.compensation_range,
    metadataObject.salary,
    metadataObject.salaryRange,
    metadataObject.salary_range,
  ]) {
    const text = sanitizeCompensationValue(candidate);
    if (text) return text;
  }

  for (const entry of arrayOfObjects(record.metadata)) {
    const label = [
      stringValue(entry.name),
      stringValue(entry.label),
      stringValue(entry.key),
    ]
      .filter(Boolean)
      .join(" ");
    if (!/compensation|salary|pay/i.test(label)) continue;
    for (const candidate of [entry.value, entry.text, entry.content]) {
      const text = sanitizeCompensationValue(candidate);
      if (text) return text;
    }
  }

  return "";
}
