import {
  computeListingFingerprint,
  computeListingSemanticKey,
  dedupeFingerprintListings,
  type ListingFingerprint,
  type ListingFingerprintInput,
} from "../discovery/listing-fingerprint.ts";
import { normalizeLeadUrl } from "./lead-normalizer.ts";

export const USER_PROVIDED_JOB_TEXT_LABEL = "User-provided job description";

const PLACEHOLDER_EMPLOYER_LABELS = new Set([
  "careers",
  "career",
  "linkedin",
  "jobs",
  "job",
  "apply",
  "job board",
  "job boards",
  "job site",
  "unknown company",
  "unknown",
]);

export type IntakeIdentity = {
  canonicalUrl: string;
  canonicalUrlKey: string;
  providerJobKey: string;
  semanticKey: string;
  fingerprintKey: string;
  locationKey: string;
  remoteBucket: ListingFingerprint["remoteBucket"];
};

export type IntakeIdentityInput = ListingFingerprintInput;

export type IntakeMatchKind = "canonical_url" | "provider" | "semantic" | null;

export type IntakeIdentityMatch = {
  matchedOn: IntakeMatchKind;
  existing: IntakeIdentity;
  incoming: IntakeIdentity;
};

export type IntakeMergeDecision = {
  action: "update" | "append" | "review";
  reason: string;
  matchedOn: IntakeMatchKind;
};

export type AttributedBoardResult<T> = {
  boardId: string;
  status: "fulfilled" | "rejected";
  value?: T | T[];
  reason?: unknown;
};

export function serializeIntakeIdentity(
  input: IntakeIdentityInput,
): IntakeIdentity {
  const fingerprint = computeListingFingerprint(input);
  return {
    canonicalUrl: fingerprint.canonicalUrl,
    canonicalUrlKey: fingerprint.canonicalUrlKey,
    providerJobKey: fingerprint.providerJobKey,
    semanticKey: fingerprint.semanticKey,
    fingerprintKey: fingerprint.fingerprintKey,
    locationKey: fingerprint.locationKey,
    remoteBucket: fingerprint.remoteBucket,
  };
}

export function reconstructIntakeIdentityFromRow(
  row: Array<string | undefined>,
): IntakeIdentity {
  return serializeIntakeIdentity({
    title: String(row[1] || ""),
    company: String(row[2] || ""),
    location: String(row[3] || ""),
    url: String(row[4] || ""),
    sourceId: String(row[5] || ""),
  });
}

export function matchPipelineIdentity(
  existing: IntakeIdentityInput,
  incoming: IntakeIdentityInput,
): IntakeIdentityMatch {
  const left = serializeIntakeIdentity(existing);
  const right = serializeIntakeIdentity(incoming);
  if (left.canonicalUrl && left.canonicalUrl === right.canonicalUrl) {
    return { matchedOn: "canonical_url", existing: left, incoming: right };
  }
  if (left.providerJobKey && left.providerJobKey === right.providerJobKey) {
    return { matchedOn: "provider", existing: left, incoming: right };
  }
  if (left.semanticKey && left.semanticKey === right.semanticKey) {
    return { matchedOn: "semantic", existing: left, incoming: right };
  }
  return { matchedOn: null, existing: left, incoming: right };
}

export function decideIntakeMergeReview(
  match: IntakeIdentityMatch,
): IntakeMergeDecision {
  if (match.matchedOn === "canonical_url" || match.matchedOn === "provider") {
    return {
      action: "update",
      reason: match.matchedOn,
      matchedOn: match.matchedOn,
    };
  }
  if (match.matchedOn === "semantic") {
    return {
      action: "review",
      reason: "semantic_collision",
      matchedOn: "semantic",
    };
  }
  return { action: "append", reason: "no_identity_match", matchedOn: null };
}

export function dedupeLeadsForProductionRun<T extends ListingFingerprintInput>(
  items: T[],
) {
  return dedupeFingerprintListings(items);
}

export function retainAttributedBoardSuccesses<T>(
  settled: Array<AttributedBoardResult<T>>,
): { leads: T[]; failures: Array<{ boardId: string; reason: string }> } {
  const leads: T[] = [];
  const failures: Array<{ boardId: string; reason: string }> = [];
  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      const value = entry.value;
      if (Array.isArray(value)) leads.push(...value);
      else if (value !== undefined) leads.push(value);
      continue;
    }
    const reason =
      entry.reason instanceof Error
        ? entry.reason.message
        : String(entry.reason || "board failed");
    failures.push({ boardId: entry.boardId, reason });
  }
  return { leads, failures };
}

export function splitManualJobText(input: {
  description?: string;
  notes?: string;
}): { notes: string; jobText: string } {
  const jobDescription = String(input.description || "").trim();
  const notes = String(input.notes || "").trim();
  return {
    notes,
    jobText: jobDescription
      ? `${USER_PROVIDED_JOB_TEXT_LABEL}:\n${jobDescription}`
      : "",
  };
}

export function sanitizeInferredEmployer(name: string, url = ""): string {
  const cleaned = String(name || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const label = cleaned
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (PLACEHOLDER_EMPLOYER_LABELS.has(label)) return "";
  const hostLabel = hostDerivedEmployerLabel(url);
  if (hostLabel && label === hostLabel && PLACEHOLDER_EMPLOYER_LABELS.has(hostLabel)) {
    return "";
  }
  return cleaned;
}

export function productionSemanticKey(input: IntakeIdentityInput): string {
  return computeListingSemanticKey(input);
}

export function canonicalIntakeUrl(url: string): string {
  return normalizeLeadUrl(url);
}

function hostDerivedEmployerLabel(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return String(host.split(".")[0] || "")
      .replace(/[-_]+/g, " ")
      .trim();
  } catch {
    return "";
  }
}
