import type {
  DiscoveryExploitOutcomeRecord,
  DiscoveryExploitOutcomeWrite,
  DiscoveryMemorySnapshot,
  DiscoveryMemoryStore as RuntimeDiscoveryMemoryStore,
  DiscoveryRoleFamilyLearnInput,
  DiscoveryRoleFamilyRecord,
} from "../contracts.ts";
import type {
  DiscoveryMemoryStore as RawDiscoveryMemoryStore,
  ExploitOutcomeRecord,
  PlannerMemorySnapshot,
  RoleFamilyRecord,
} from "./discovery-memory-store.ts";

type RunDiscoveryMemoryStore = Pick<
  RuntimeDiscoveryMemoryStore,
  "loadSnapshot" | "writeExploitOutcome" | "learnRoleFamilyFromLead"
>;

export function createRunDiscoveryMemoryStore(
  rawDiscoveryMemoryStore: RawDiscoveryMemoryStore,
): RunDiscoveryMemoryStore {
  return {
    loadSnapshot(input) {
      return toRunMemorySnapshot(
        rawDiscoveryMemoryStore.loadPlannerSnapshot({
          intentKey: input.intentKey,
          now: input.run.request.requestedAt || new Date().toISOString(),
        }),
        input.intentKey,
      );
    },
    writeExploitOutcome(input: DiscoveryExploitOutcomeWrite) {
      return toRunExploitOutcomeRecord(
        rawDiscoveryMemoryStore.writeExploitOutcome(input),
      );
    },
    learnRoleFamilyFromLead(input: DiscoveryRoleFamilyLearnInput) {
      const record = rawDiscoveryMemoryStore.learnRoleFamilyFromLead(input);
      return record ? toRunRoleFamilyRecord(record) : null;
    },
  };
}

function toRunMemorySnapshot(
  snapshot: PlannerMemorySnapshot,
  intentKey: string,
): DiscoveryMemorySnapshot {
  return {
    intentKey,
    companies: snapshot.companies.map((company) => ({
      companyKey: String(company.companyKey || ""),
      displayName: String(company.displayName || ""),
      normalizedName: String(company.normalizedName || ""),
      aliasesJson: JSON.stringify(company.aliases || []),
      domainsJson: JSON.stringify(company.domains || []),
      atsHintsJson: JSON.stringify(flattenHintRecord(company.atsHints)),
      geoTagsJson: JSON.stringify(company.geoTags || []),
      roleTagsJson: JSON.stringify(company.roleTags || []),
      firstSeenAt: String(company.firstSeenAt || ""),
      lastSeenAt: String(company.lastSeenAt || ""),
      lastSuccessAt: String(company.lastSuccessAt || ""),
      successCount: Number(company.successCount || 0),
      failureCount: Number(company.failureCount || 0),
      confidence: Number(company.confidence || 0),
      cooldownUntil: String(company.cooldownUntil || ""),
    })),
    careerSurfaces: snapshot.careerSurfaces.map((surface) => ({
      surfaceId: String(surface.surfaceId || ""),
      companyKey: String(surface.companyKey || ""),
      surfaceType: String(surface.surfaceType || ""),
      providerType: String(surface.providerType || ""),
      canonicalUrl: String(surface.canonicalUrl || ""),
      host: String(surface.host || ""),
      finalUrl: String(surface.finalUrl || ""),
      boardToken: String(surface.boardToken || ""),
      sourceLane: String(surface.sourceLane || "ats_provider"),
      verifiedStatus: String(surface.verifiedStatus || "pending"),
      lastVerifiedAt: String(surface.lastVerifiedAt || ""),
      lastSuccessAt: String(surface.lastSuccessAt || ""),
      lastFailureAt: String(surface.lastFailureAt || ""),
      failureReason: String(surface.failureReason || ""),
      failureStreak: Number(surface.failureStreak || 0),
      cooldownUntil: String(surface.cooldownUntil || ""),
      metadataJson: JSON.stringify(surface.metadata || {}),
    })),
    deadLinks: [],
    listingFingerprints: [],
    intentCoverage: snapshot.intentCoverage.map((coverage) => ({
      intentKey: String(coverage.intentKey || ""),
      companyKey: String(coverage.companyKey || ""),
      runId: String(coverage.runId || ""),
      sourceLane: String(coverage.sourceLane || "grounded_web"),
      surfacesSeen: Number(coverage.surfacesSeen || 0),
      listingsSeen: Number(coverage.listingsSeen || 0),
      listingsWritten: Number(coverage.listingsWritten || 0),
      startedAt: String(coverage.startedAt || ""),
      completedAt: String(coverage.completedAt || ""),
    })),
    roleFamilies: snapshot.roleFamilies.map((family) =>
      toRunRoleFamilyRecord(family),
    ),
  };
}

function toRunExploitOutcomeRecord(
  record: ExploitOutcomeRecord,
): DiscoveryExploitOutcomeRecord {
  return {
    outcomeKey: String(record.outcomeKey || ""),
    runId: String(record.runId || ""),
    intentKey: String(record.intentKey || ""),
    surfaceId: String(record.surfaceId || ""),
    companyKey: String(record.companyKey || ""),
    sourceId: String(record.sourceId || "grounded_web"),
    sourceLane: String(record.sourceLane || "grounded_web"),
    surfaceType: String(record.surfaceType || "job_posting"),
    canonicalUrl: String(record.canonicalUrl || ""),
    observedAt: String(record.observedAt || ""),
    listingsSeen: Number(record.listingsSeen || 0),
    listingsAccepted: Number(record.listingsAccepted || 0),
    listingsRejected: Number(record.listingsRejected || 0),
    listingsWritten: Number(record.listingsWritten || 0),
    rejectionReasonsJson: JSON.stringify(record.rejectionReasons || {}),
    rejectionSamplesJson: JSON.stringify(record.rejectionSamples || []),
  };
}

function toRunRoleFamilyRecord(
  record: RoleFamilyRecord,
): DiscoveryRoleFamilyRecord {
  return {
    familyKey: String(record.familyKey || ""),
    baseRole: String(record.baseRole || ""),
    roleVariantsJson: JSON.stringify(record.roleVariants || []),
    companyKey: String(record.companyKey || ""),
    sourceLane: String(record.sourceLane || ""),
    confirmedCount: Number(record.confirmedCount || 0),
    nearMissCount: Number(record.nearMissCount || 0),
    lastConfirmedAt: nullableString(record.lastConfirmedAt),
    createdAt: String(record.createdAt || ""),
    updatedAt: String(record.updatedAt || ""),
  };
}

function flattenHintRecord(value: unknown): Record<string, string> {
  const parsed = parseJsonObject(value);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (Array.isArray(entry)) {
      const first = entry.map((item) => String(item || "").trim()).find(Boolean);
      if (first) out[key] = first;
      continue;
    }
    const normalized = String(entry || "").trim();
    if (normalized) out[key] = normalized;
  }
  return out;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nullableString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}
