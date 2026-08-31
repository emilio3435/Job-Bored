import { computeListingFingerprintKey } from "../../discovery/listing-fingerprint.ts";

export type FingerprintMemoryRecord = {
  fingerprintKey: string;
  sourceId: string;
  canonicalUrl?: string;
  priorAcceptedYield?: number;
  seenCount?: number;
  seenAt?: string;
};

export type FrontierMemorySnapshot = {
  fingerprints?: FingerprintMemoryRecord[];
};

export type DeclaredFrontierSignals = {
  verifiedSurface?: boolean;
  presetAligned?: boolean;
  priorAcceptedYield?: number;
  recentCoveragePenalty?: number;
  cooldownPenalty?: number;
  fingerprintRecall?: FingerprintMemoryRecord | null;
};

export type FrontierSignalScore = {
  score: number;
  attribution: string[];
};

// Mirror of declared frontier-scorer weights that currently do not all
// participate in computeFrontierCompositeScore (verified surface, preset
// alignment). F4-B owns scout/exploit order; this helper is the attribution
// side so those signals are observable in tests.
const VERIFIED_SURFACE_WEIGHT = 0.08;
const PRESET_ALIGNMENT_WEIGHT = 0.04;
const PRIOR_YIELD_WEIGHT = 0.14;
const COVERAGE_PENALTY_WEIGHT = 0.08;
const COOLDOWN_PENALTY_WEIGHT = 0.12;
const FINGERPRINT_MEMORY_WEIGHT = 0.1;

export function applyDeclaredFrontierSignals(input: {
  baseScore: number;
  signals: DeclaredFrontierSignals;
}): FrontierSignalScore {
  const signals = input.signals || {};
  const yieldScore = Number.isFinite(signals.priorAcceptedYield)
    ? Number(signals.priorAcceptedYield)
    : signals.fingerprintRecall?.priorAcceptedYield;
  let delta = 0;
  const attribution: string[] = [];

  if (signals.verifiedSurface) {
    delta += 100 * VERIFIED_SURFACE_WEIGHT;
    attribution.push("verified_surface");
  }
  if (signals.presetAligned) {
    delta += 100 * PRESET_ALIGNMENT_WEIGHT;
    attribution.push("preset_aligned");
  }
  if (typeof yieldScore === "number" && Number.isFinite(yieldScore) && yieldScore > 0) {
    delta += yieldScore * PRIOR_YIELD_WEIGHT;
    attribution.push(`yield:${Math.round(yieldScore)}`);
  }
  if (signals.fingerprintRecall) {
    delta += 100 * FINGERPRINT_MEMORY_WEIGHT;
    attribution.push("fingerprint_memory");
  }
  if ((signals.recentCoveragePenalty || 0) > 0) {
    delta -= Number(signals.recentCoveragePenalty) * COVERAGE_PENALTY_WEIGHT;
    attribution.push(`coverage:${Math.round(Number(signals.recentCoveragePenalty))}`);
  }
  if ((signals.cooldownPenalty || 0) > 0) {
    delta -= Number(signals.cooldownPenalty) * COOLDOWN_PENALTY_WEIGHT;
    attribution.push(`cooldown:${Math.round(Number(signals.cooldownPenalty))}`);
  }

  const score = Math.max(0, Math.min(100, Number(input.baseScore) + delta));
  return {
    score: Math.round(score * 100) / 100,
    attribution,
  };
}

export function recallFingerprintMemory(
  snapshot: FrontierMemorySnapshot | undefined,
  listing: {
    sourceId?: string;
    title?: string;
    company?: string;
    location?: string;
    url?: string;
  },
): FingerprintMemoryRecord | null {
  const fingerprintKey = computeListingFingerprintKey(listing);
  if (!fingerprintKey) return null;
  const records = snapshot?.fingerprints || [];
  return (
    records.find((record) => record.fingerprintKey === fingerprintKey) || null
  );
}
