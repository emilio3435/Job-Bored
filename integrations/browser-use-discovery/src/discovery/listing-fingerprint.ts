import { createHash } from "node:crypto";

import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";

export type ListingFingerprintInput = {
  sourceId?: string;
  sourceLabel?: string;
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  compensationText?: string;
  contact?: string;
  descriptionText?: string;
  fitAssessment?: string;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
  fitScore?: number | null;
  priority?: string | null;
};

export type RemoteBucket = "remote" | "hybrid" | "onsite" | "unknown";

export type ListingFingerprint = {
  providerType: string;
  canonicalUrl: string;
  canonicalUrlKey: string;
  providerJobId: string;
  providerJobKey: string;
  primaryFingerprintKeys: string[];
  remoteBucket: RemoteBucket;
  companyKey: string;
  titleKey: string;
  locationKey: string;
  semanticKey: string;
  contentHash: string;
  fingerprintKey: string;
  qualityScore: number;
};

export type ListingDuplicateMatchKind = "primary" | "semantic" | "content";

export type ListingDuplicateGroup = {
  keptIndex: number;
  droppedIndices: number[];
  matchedOn: ListingDuplicateMatchKind[];
};

export type ListingDeduplicationResult<T extends ListingFingerprintInput> = {
  uniqueItems: T[];
  uniqueFingerprints: ListingFingerprint[];
  allFingerprints: ListingFingerprint[];
  duplicateCount: number;
  duplicateGroups: ListingDuplicateGroup[];
};

type ProviderRule = {
  provider: string;
  hostPatterns: RegExp[];
  queryKeys: string[];
  pathPatterns: RegExp[];
  fallbackToLastSegment?: boolean;
};

const REMOTE_PATTERN =
  /\b(remote|remote-first|remote first|distributed|work from home|wfh|anywhere)\b/i;
const HYBRID_PATTERN = /\bhybrid\b/i;
const ONSITE_PATTERN =
  /\b(on[\s-]?site|onsite|in[\s-]?office|office-based)\b/i;

const METADATA_JOB_ID_KEYS = new Set([
  "providerjobid",
  "jobid",
  "job_id",
  "postingid",
  "posting_id",
  "externaljobid",
  "external_job_id",
  "requisitionid",
  "requisition_id",
  "careerjobreqid",
  "career_job_req_id",
  "reqid",
  "req_id",
  "openingid",
  "opening_id",
  "internaljobid",
  "internal_job_id",
  "positionid",
  "position_id",
  "vacancyid",
  "vacancy_id",
  "jobreqid",
  "jobreq_id",
  "jobreqnumber",
  "referenceid",
  "reference_id",
  "id",
]);

const COMMON_QUERY_JOB_ID_KEYS = [
  "gh_jid",
  "job",
  "jobId",
  "job_id",
  "postingId",
  "posting_id",
  "requisitionId",
  "requisition_id",
  "career_job_req_id",
  "jobReqId",
  "jobReqID",
  "reqId",
  "req_id",
  "rid",
  "jk",
  "j",
] as const;

const PROVIDER_RULES: ProviderRule[] = [
  {
    provider: "greenhouse",
    hostPatterns: [
      /(^|\.)greenhouse\.io$/i,
      /(^|\.)boards\.greenhouse\.io$/i,
      /(^|\.)job-boards\.greenhouse\.io$/i,
    ],
    queryKeys: ["gh_jid", "jobId", "job_id", "job"],
    pathPatterns: [/\/jobs\/([^/?#]+)/i],
  },
  {
    provider: "lever",
    hostPatterns: [/(^|\.)jobs\.lever\.co$/i, /(^|\.)lever\.co$/i],
    queryKeys: ["postingId", "posting_id", "jobId", "job_id"],
    pathPatterns: [/\/postings\/([^/?#]+)/i, /\/[^/]+\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "ashby",
    hostPatterns: [/(^|\.)jobs\.ashbyhq\.com$/i, /(^|\.)ashbyhq\.com$/i],
    queryKeys: ["jobId", "job_id"],
    pathPatterns: [/\/[^/]+\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "smartrecruiters",
    hostPatterns: [/(^|\.)jobs\.smartrecruiters\.com$/i],
    queryKeys: ["jobId", "job_id"],
    pathPatterns: [/\/jobs\/([^/?#]+)/i, /\/([^/?#]+)$/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "workday",
    hostPatterns: [
      /(^|\.)myworkdayjobs\.com$/i,
      /(^|\.)workdayjobs\.com$/i,
    ],
    queryKeys: ["jobId", "job_id", "jobReqId", "jobReqID", "j"],
    pathPatterns: [
      /\/job(?:\/[^/]+)*\/[^/?#]*_([a-z0-9]+(?:-[a-z0-9]+)+)$/i,
      /\/job(?:\/[^/]+)*\/([^/?#]+)/i,
      /\/([^/?#]+)\/apply$/i,
    ],
    fallbackToLastSegment: true,
  },
  {
    provider: "icims",
    hostPatterns: [/(^|\.)icims\.com$/i],
    queryKeys: ["job", "jobId", "job_id"],
    pathPatterns: [/\/jobs\/([^/?#]+)/i],
  },
  {
    provider: "jobvite",
    hostPatterns: [/(^|\.)jobvite\.com$/i, /(^|\.)jobs\.jobvite\.com$/i],
    queryKeys: ["jobId", "job_id"],
    pathPatterns: [/\/job\/([^/?#]+)/i, /\/jobs\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "taleo",
    hostPatterns: [/(^|\.)taleo\.net$/i, /(^|\.)oraclecloud\.com$/i],
    queryKeys: ["job", "jobId", "job_id", "rid"],
    pathPatterns: [],
  },
  {
    provider: "successfactors",
    hostPatterns: [
      /(^|\.)successfactors\.[a-z.]+$/i,
      /(^|\.)jobs\.sap\.com$/i,
    ],
    queryKeys: ["career_job_req_id", "jobId", "jobReqId", "req_id"],
    pathPatterns: [/\/job\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "workable",
    hostPatterns: [/(^|\.)workable\.com$/i, /(^|\.)applytojob\.com$/i],
    queryKeys: ["jobId", "job_id"],
    pathPatterns: [/\/j\/([^/?#]+)/i, /\/jobs\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "breezy",
    hostPatterns: [/(^|\.)breezy\.hr$/i],
    queryKeys: ["jobId", "job_id"],
    pathPatterns: [/\/p\/([^/?#]+)/i, /#\/positions\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "recruitee",
    hostPatterns: [/(^|\.)recruitee\.com$/i],
    queryKeys: ["jobId", "job_id"],
    pathPatterns: [/\/o\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "teamtailor",
    hostPatterns: [/(^|\.)teamtailor\.com$/i],
    queryKeys: ["jobId", "job_id"],
    pathPatterns: [/\/jobs\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
  {
    provider: "personio",
    hostPatterns: [/(^|\.)personio\.(com|de)$/i],
    queryKeys: ["jobId", "job_id", "positionId", "position_id"],
    pathPatterns: [/\/job\/([^/?#]+)/i, /\/position\/([^/?#]+)/i],
    fallbackToLastSegment: true,
  },
];

const PRIORITY_SCORES: Record<string, number> = {
  "🔥": 30,
  "⚡": 20,
  "—": 5,
  "↓": 0,
  "": 0,
};

export function normalizeFingerprintText(input: string): string {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bu\.?s\.?a?\b/g, "united states")
    .replace(/\bu\.?k\.?\b/g, "united kingdom")
    .replace(/\bnyc\b/g, "new york")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeListingRemoteBucket(
  input: Pick<
    ListingFingerprintInput,
    "location" | "title" | "descriptionText" | "fitAssessment" | "tags"
  >,
): RemoteBucket {
  const haystack = [
    input.location || "",
    input.title || "",
    input.descriptionText || "",
    input.fitAssessment || "",
    ...(input.tags || []),
  ]
    .filter(Boolean)
    .join(" ");
  const normalized = normalizeWhitespace(haystack).toLowerCase();
  if (!normalized) return "unknown";
  const hasRemote = REMOTE_PATTERN.test(normalized);
  const hasHybrid = HYBRID_PATTERN.test(normalized);
  const hasOnsite = ONSITE_PATTERN.test(normalized);
  if (hasHybrid || (hasRemote && hasOnsite)) return "hybrid";
  if (hasRemote) return "remote";
  if (hasOnsite) return "onsite";
  return "unknown";
}

export function computeListingLocationKey(location: string): string {
  return normalizeFingerprintText(location || "") || "unknown-location";
}

export function inferListingProviderType(
  input: Pick<ListingFingerprintInput, "sourceId" | "url">,
): string {
  const normalizedSourceId = normalizeSourceId(input.sourceId || "");
  if (normalizedSourceId && normalizedSourceId !== "grounded_web") {
    return normalizedSourceId;
  }
  const hostname = safeHostname(input.url || "");
  if (!hostname) return normalizedSourceId;
  for (const rule of PROVIDER_RULES) {
    if (rule.hostPatterns.some((pattern) => pattern.test(hostname))) {
      return rule.provider;
    }
  }
  return normalizedSourceId;
}

export function computeListingProviderJobId(
  input: Pick<ListingFingerprintInput, "sourceId" | "url" | "metadata">,
): string {
  const fromMetadata = extractProviderJobIdFromMetadata(input.metadata);
  if (fromMetadata) return fromMetadata;

  const rawUrl = String(input.url || "").trim();
  if (!rawUrl) return "";

  const providerType = inferListingProviderType(input);
  const providerRule = providerType
    ? PROVIDER_RULES.find((rule) => rule.provider === providerType) || null
    : null;
  const parsed = safeParseUrl(rawUrl);

  for (const key of providerRule?.queryKeys || []) {
    const value = parsed?.searchParams.get(key) || "";
    const normalized = normalizeProviderJobId(value);
    if (normalized) return normalized;
  }
  for (const key of COMMON_QUERY_JOB_ID_KEYS) {
    const value = parsed?.searchParams.get(key) || "";
    const normalized = normalizeProviderJobId(value);
    if (normalized) return normalized;
  }

  for (const pattern of providerRule?.pathPatterns || []) {
    for (const candidate of [parsed?.pathname || "", parsed?.hash || "", rawUrl]) {
      if (!candidate) continue;
      const match = candidate.match(pattern);
      const normalized = normalizeProviderJobId(match?.[1] || "");
      if (normalized) return normalized;
    }
  }

  if (providerRule?.fallbackToLastSegment) {
    const normalized = normalizeProviderJobId(lastUsefulPathSegment(rawUrl));
    if (normalized) return normalized;
  }

  return "";
}

export function computeListingPrimaryFingerprintKeys(
  input: Pick<ListingFingerprintInput, "sourceId" | "url" | "metadata">,
): string[] {
  const canonicalUrl = normalizeLeadUrl(input.url || "");
  const providerType = inferListingProviderType({
    sourceId: input.sourceId,
    url: canonicalUrl || input.url,
  });
  const providerJobId = computeListingProviderJobId(input);
  return dedupeStrings([
    canonicalUrl ? `url:${canonicalUrl}` : "",
    providerJobId
      ? `provider:${providerType || normalizeSourceId(input.sourceId || "") || "unknown"}:${providerJobId}`
      : "",
  ]);
}

export function computeListingSemanticKey(
  input: Pick<
    ListingFingerprintInput,
    "company" | "title" | "location" | "descriptionText" | "fitAssessment" | "tags"
  >,
): string {
  const companyKey = normalizeFingerprintText(input.company || "");
  const titleKey = normalizeFingerprintText(input.title || "");
  if (!companyKey || !titleKey) return "";
  const locationKey = computeListingLocationKey(input.location || "");
  const remoteBucket = computeListingRemoteBucket(input);
  return `semantic:${companyKey}|${titleKey}|${locationKey}|${remoteBucket}`;
}

export function computeListingContentHash(
  input: Pick<
    ListingFingerprintInput,
    | "company"
    | "title"
    | "location"
    | "descriptionText"
    | "fitAssessment"
    | "compensationText"
    | "contact"
    | "tags"
  >,
): string {
  const descriptionText = normalizeFingerprintText(
    input.descriptionText || input.fitAssessment || "",
  );
  const parts = [
    normalizeFingerprintText(input.company || ""),
    normalizeFingerprintText(input.title || ""),
    computeListingLocationKey(input.location || ""),
    computeListingRemoteBucket(input),
    descriptionText,
    normalizeFingerprintText(input.compensationText || ""),
    normalizeFingerprintText(input.contact || ""),
    normalizeTagKey(input.tags || []),
  ];
  if (!parts.some(Boolean)) return "";
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

export function computeListingFingerprint(
  input: ListingFingerprintInput,
): ListingFingerprint {
  const canonicalUrl = normalizeLeadUrl(input.url || "");
  const providerType = inferListingProviderType({
    sourceId: input.sourceId,
    url: canonicalUrl || input.url,
  });
  const providerJobId = computeListingProviderJobId(input);
  const primaryFingerprintKeys = computeListingPrimaryFingerprintKeys(input);
  const canonicalUrlKey =
    primaryFingerprintKeys.find((key) => key.startsWith("url:")) || "";
  const providerJobKey =
    primaryFingerprintKeys.find((key) => key.startsWith("provider:")) || "";
  const companyKey = normalizeFingerprintText(input.company || "");
  const titleKey = normalizeFingerprintText(input.title || "");
  const locationKey = computeListingLocationKey(input.location || "");
  const remoteBucket = computeListingRemoteBucket(input);
  const semanticKey = computeListingSemanticKey(input);
  const contentHash = computeListingContentHash(input);
  const qualityScore = scoreListingQuality(input, {
    canonicalUrlKey,
    providerJobKey,
    locationKey,
    remoteBucket,
  });

  return {
    providerType,
    canonicalUrl,
    canonicalUrlKey,
    providerJobId,
    providerJobKey,
    primaryFingerprintKeys,
    remoteBucket,
    companyKey,
    titleKey,
    locationKey,
    semanticKey,
    contentHash,
    fingerprintKey:
      primaryFingerprintKeys[0] || semanticKey || contentHash || "",
    qualityScore,
  };
}

export function computeListingFingerprintKey(
  input: ListingFingerprintInput,
): string {
  return computeListingFingerprint(input).fingerprintKey;
}

export function dedupeFingerprintListings<T extends ListingFingerprintInput>(
  items: T[],
): ListingDeduplicationResult<T> {
  const allFingerprints = items.map((item) => computeListingFingerprint(item));
  const unionFind = createUnionFind(items.length);
  const keyOwners = new Map<string, number>();

  for (let index = 0; index < allFingerprints.length; index += 1) {
    const fingerprint = allFingerprints[index];
    for (const key of fingerprint.primaryFingerprintKeys) {
      registerFingerprintKey(keyOwners, unionFind, `primary|${key}`, index);
    }
    if (fingerprint.semanticKey) {
      registerFingerprintKey(
        keyOwners,
        unionFind,
        `semantic|${fingerprint.semanticKey}`,
        index,
      );
    }
    if (fingerprint.contentHash) {
      registerFingerprintKey(
        keyOwners,
        unionFind,
        `content|${fingerprint.contentHash}`,
        index,
      );
    }
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < items.length; index += 1) {
    const root = unionFind.find(index);
    const indices = groups.get(root) || [];
    indices.push(index);
    groups.set(root, indices);
  }

  const orderedGroups = [...groups.values()]
    .map((indices) => {
      const keptIndex = selectPreferredIndex(indices, items, allFingerprints);
      const firstSeenIndex = Math.min(...indices);
      const droppedIndices = indices.filter((index) => index !== keptIndex);
      return {
        keptIndex,
        firstSeenIndex,
        droppedIndices,
        matchedOn: collectMatchedKinds(indices, allFingerprints),
      };
    })
    .sort((left, right) => left.firstSeenIndex - right.firstSeenIndex);

  return {
    uniqueItems: orderedGroups.map((group) => items[group.keptIndex]),
    uniqueFingerprints: orderedGroups.map(
      (group) => allFingerprints[group.keptIndex],
    ),
    allFingerprints,
    duplicateCount: orderedGroups.reduce(
      (count, group) => count + group.droppedIndices.length,
      0,
    ),
    duplicateGroups: orderedGroups
      .filter((group) => group.droppedIndices.length > 0)
      .map((group) => ({
        keptIndex: group.keptIndex,
        droppedIndices: group.droppedIndices,
        matchedOn: group.matchedOn,
      })),
  };
}

function normalizeWhitespace(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSourceId(input: string): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeProviderJobId(input: string): string {
  const raw = normalizeWhitespace(safeDecodeURIComponent(input || ""))
    .replace(/^\/+|\/+$/g, "")
    .split(/[?#]/, 1)[0] || "";
  if (!raw) return "";
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) return "";
  if (GENERIC_PATH_SEGMENTS.has(normalized)) return "";
  return normalized;
}

function safeDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function safeParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function safeHostname(input: string): string {
  return safeParseUrl(input)?.hostname.toLowerCase() || "";
}

function lastUsefulPathSegment(url: string): string {
  const pathname = safeParseUrl(url)?.pathname || "";
  const parts = pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .reverse();
  for (const part of parts) {
    const normalized = normalizeProviderJobId(part);
    if (!normalized) continue;
    if (GENERIC_PATH_SEGMENTS.has(normalized)) continue;
    return part;
  }
  return "";
}

function extractProviderJobIdFromMetadata(
  value: Record<string, unknown> | null | undefined,
): string {
  if (!value || typeof value !== "object") return "";
  const visited = new Set<unknown>();
  return findJobIdInMetadata(value, visited, 0);
}

function findJobIdInMetadata(
  value: unknown,
  visited: Set<unknown>,
  depth: number,
): string {
  if (depth > 4 || value == null) return "";
  if (typeof value !== "object") return "";
  if (visited.has(value)) return "";
  visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findJobIdInMetadata(entry, visited, depth + 1);
      if (found) return found;
    }
    return "";
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = normalizeSourceId(key);
    if (METADATA_JOB_ID_KEYS.has(normalizedKey)) {
      const normalized = normalizeProviderJobId(stringValue(entry));
      if (normalized) return normalized;
    }
  }

  for (const entry of Object.values(value)) {
    const found = findJobIdInMetadata(entry, visited, depth + 1);
    if (found) return found;
  }
  return "";
}

function stringValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function normalizeTagKey(tags: string[]): string {
  return dedupeStrings(tags.map((tag) => normalizeFingerprintText(tag)))
    .sort()
    .join(",");
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function scoreListingQuality(
  input: ListingFingerprintInput,
  fingerprint: Pick<
    ListingFingerprint,
    "canonicalUrlKey" | "providerJobKey" | "locationKey" | "remoteBucket"
  >,
): number {
  const descriptionLength = normalizeWhitespace(
    input.descriptionText || input.fitAssessment || "",
  ).length;
  const fitScore = Number.isFinite(input.fitScore) ? Number(input.fitScore) : 0;
  const metadataCount =
    input.metadata && typeof input.metadata === "object"
      ? Object.keys(input.metadata).length
      : 0;
  let score = 0;
  if (fingerprint.providerJobKey) score += 80;
  if (fingerprint.canonicalUrlKey) score += 60;
  if (normalizeFingerprintText(input.title || "")) score += 20;
  if (normalizeFingerprintText(input.company || "")) score += 20;
  if (fingerprint.locationKey !== "unknown-location") score += 25;
  if (fingerprint.remoteBucket !== "unknown") score += 10;
  if (normalizeWhitespace(input.compensationText || "")) score += 25;
  if (normalizeWhitespace(input.contact || "")) score += 15;
  score += Math.min(descriptionLength, 400);
  score += dedupeStrings(input.tags || []).length * 4;
  score += metadataCount * 2;
  score += fitScore * 35;
  score += PRIORITY_SCORES[String(input.priority || "")] || 0;
  if (normalizeSourceId(input.sourceId || "") !== "grounded_web") score += 10;
  return score;
}

function registerFingerprintKey(
  owners: Map<string, number>,
  unionFind: ReturnType<typeof createUnionFind>,
  key: string,
  index: number,
): void {
  if (!key) return;
  const existing = owners.get(key);
  if (existing == null) {
    owners.set(key, index);
    return;
  }
  unionFind.union(existing, index);
}

function selectPreferredIndex<T extends ListingFingerprintInput>(
  indices: number[],
  items: T[],
  fingerprints: ListingFingerprint[],
): number {
  let bestIndex = indices[0];
  for (let cursor = 1; cursor < indices.length; cursor += 1) {
    const candidateIndex = indices[cursor];
    if (
      isPreferredCandidate(
        candidateIndex,
        bestIndex,
        items,
        fingerprints,
      )
    ) {
      bestIndex = candidateIndex;
    }
  }
  return bestIndex;
}

function isPreferredCandidate<T extends ListingFingerprintInput>(
  candidateIndex: number,
  currentIndex: number,
  items: T[],
  fingerprints: ListingFingerprint[],
): boolean {
  const candidateFingerprint = fingerprints[candidateIndex];
  const currentFingerprint = fingerprints[currentIndex];
  if (candidateFingerprint.qualityScore !== currentFingerprint.qualityScore) {
    return candidateFingerprint.qualityScore > currentFingerprint.qualityScore;
  }

  const candidateFit = Number.isFinite(items[candidateIndex].fitScore)
    ? Number(items[candidateIndex].fitScore)
    : 0;
  const currentFit = Number.isFinite(items[currentIndex].fitScore)
    ? Number(items[currentIndex].fitScore)
    : 0;
  if (candidateFit !== currentFit) return candidateFit > currentFit;

  const candidateDescriptionLength = normalizeWhitespace(
    items[candidateIndex].descriptionText ||
      items[candidateIndex].fitAssessment ||
      "",
  ).length;
  const currentDescriptionLength = normalizeWhitespace(
    items[currentIndex].descriptionText ||
      items[currentIndex].fitAssessment ||
      "",
  ).length;
  if (candidateDescriptionLength !== currentDescriptionLength) {
    return candidateDescriptionLength > currentDescriptionLength;
  }

  if (
    candidateFingerprint.providerJobKey &&
    !currentFingerprint.providerJobKey
  ) {
    return true;
  }
  if (
    candidateFingerprint.canonicalUrlKey &&
    !currentFingerprint.canonicalUrlKey
  ) {
    return true;
  }

  return candidateIndex < currentIndex;
}

function collectMatchedKinds(
  indices: number[],
  fingerprints: ListingFingerprint[],
): ListingDuplicateMatchKind[] {
  const matched = new Set<ListingDuplicateMatchKind>();

  const primaryKeys = new Map<string, number>();
  for (const index of indices) {
    for (const key of fingerprints[index].primaryFingerprintKeys) {
      primaryKeys.set(key, (primaryKeys.get(key) || 0) + 1);
    }
  }
  if ([...primaryKeys.values()].some((count) => count > 1)) {
    matched.add("primary");
  }

  if (hasSharedValue(indices, fingerprints, "semanticKey")) {
    matched.add("semantic");
  }
  if (hasSharedValue(indices, fingerprints, "contentHash")) {
    matched.add("content");
  }

  return [...matched];
}

function hasSharedValue(
  indices: number[],
  fingerprints: ListingFingerprint[],
  field: "semanticKey" | "contentHash",
): boolean {
  const seen = new Set<string>();
  for (const index of indices) {
    const value = fingerprints[index][field];
    if (!value) continue;
    if (seen.has(value)) return true;
    seen.add(value);
  }
  return false;
}

function createUnionFind(size: number) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const rank = Array.from({ length: size }, () => 0);

  function find(index: number): number {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  }

  function union(left: number, right: number): void {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (rank[leftRoot] < rank[rightRoot]) {
      parent[leftRoot] = rightRoot;
      return;
    }
    if (rank[leftRoot] > rank[rightRoot]) {
      parent[rightRoot] = leftRoot;
      return;
    }
    parent[rightRoot] = leftRoot;
    rank[leftRoot] += 1;
  }

  return { find, union };
}

const GENERIC_PATH_SEGMENTS = new Set([
  "apply",
  "career",
  "careers",
  "job",
  "jobs",
  "openings",
  "positions",
  "posting",
  "postings",
]);
